import "server-only";

import {
  ConnectorConfigError,
  ConnectorReauthRequiredError,
  ProviderApiError,
} from "../core/errors";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import {
  LOCAL_FALLBACK_BASE_URL,
  listRedirectBaseUrls,
  resolveRequestUrl,
  type AppUrlEnv,
  type RedirectRequestContext,
} from "@/lib/app-url";

/**
 * Mercado Livre (PR012) — official Meli API, server-side ONLY.
 *
 * Implements the documented OAuth2 flow:
 *   buildMercadoLivreAuthorizationUrl() → auth.mercadolivre.com.br
 *   /api/mercadolivre/callback receives (code, state) →
 *   exchangeMercadoLivreCode() swaps the code for an access/refresh token
 *   pair (POST api.mercadolibre.com/oauth/token), refreshMercadoLivreToken()
 *   rotates it transparently before expiry (6h lifetime).
 *
 * REDIRECT URI CONTRACT (PR016.1)
 * -------------------------------
 * Meli validates `redirect_uri` TWICE — once on `/authorization` and once on
 * the code exchange, where the two values must be byte-identical and must
 * match the URI registered in DevCenter. Any divergence (a stale `APP_URL`,
 * a deploy answering on a second domain, the apex vs. the `www` host) fails
 * the exchange with `invalid_grant`; the connector then keeps whatever stale
 * token it had and every later call dies with "Não foi possível listar os
 * anúncios do Mercado Livre". `mercadoLivreRedirectUriCandidates()` is the
 * single source of truth for that value: `MERCADOLIVRE_REDIRECT_URI` →
 * `APP_URL` → `NEXTAUTH_URL` → the callback request's own public URL, which
 * is literally where Meli delivered the browser.
 */

const MELI_API_BASE_URL = "https://api.mercadolibre.com";
const MELI_AUTH_BASE_URL = "https://auth.mercadolivre.com.br";
const PROVIDER = "MERCADOLIVRE" as const;

/** Canonical callback path of this application. */
export const MERCADOLIVRE_CALLBACK_PATH = "/api/mercadolivre/callback";

/**
 * Label of the single call to action that fixes every authorization failure
 * of this channel. Exported so the panel copy and the error messages the
 * operator reads can never drift apart.
 */
export const MERCADOLIVRE_CONNECT_CTA = "Conectar Conta do Mercado Livre";

export interface MercadoLivreConfig {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  authBaseUrl: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConnectorConfigError(name, PROVIDER);
  return value;
}

/** Server-only config; the client secret never leaves this module. */
export function getMercadoLivreConfig(): MercadoLivreConfig {
  return {
    clientId: requiredEnv("MERCADOLIVRE_CLIENT_ID"),
    clientSecret: requiredEnv("MERCADOLIVRE_CLIENT_SECRET"),
    apiBaseUrl: process.env.MERCADOLIVRE_API_BASE_URL?.trim() || MELI_API_BASE_URL,
    authBaseUrl: process.env.MERCADOLIVRE_AUTH_BASE_URL?.trim() || MELI_AUTH_BASE_URL,
  };
}

/** Accepts only absolute http(s) URIs; trailing slashes are dropped. */
function normalizeRedirectUri(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, "") ?? "";
  return /^https?:\/\/[^/]+/i.test(trimmed) ? trimmed : "";
}

/**
 * Every redirect URI this deployment may legitimately present to Meli, in
 * precedence order and de-duplicated.
 *
 * 1. `MERCADOLIVRE_REDIRECT_URI` — an explicit operator override always wins.
 * 2. `APP_URL`, then `NEXTAUTH_URL` — the Render-configured public address
 *    (the fix for the domain divergence this function exists for).
 * 3. The inbound callback request's own public URL (`X-Forwarded-Host` behind
 *    Render's proxy). Only available during the exchange, where it is the
 *    ground truth, and it also covers the `/api/connectors/mercadolivre/…`
 *    alias path.
 * 4. `http://localhost:3000` — local development only.
 */
export function mercadoLivreRedirectUriCandidates(
  request?: RedirectRequestContext,
  env: AppUrlEnv = process.env,
): string[] {
  const candidates = [
    normalizeRedirectUri(env.MERCADOLIVRE_REDIRECT_URI),
    // Configured bases only: the request is handled separately below so its
    // real path (not the canonical one) is preserved.
    ...listRedirectBaseUrls(undefined, env).map((base) => `${base}${MERCADOLIVRE_CALLBACK_PATH}`),
    normalizeRedirectUri(resolveRequestUrl(request)),
    `${LOCAL_FALLBACK_BASE_URL}${MERCADOLIVRE_CALLBACK_PATH}`,
  ];
  return candidates.filter(
    (candidate, index) => candidate.length > 0 && candidates.indexOf(candidate) === index,
  );
}

/**
 * The redirect URI to present to Mercado Livre — the first candidate.
 *
 * It MUST be registered verbatim in DevCenter
 * (developers.mercadolivre.com.br → your application → Redirect URI).
 */
export function resolveMercadoLivreRedirectUri(
  request?: RedirectRequestContext,
  env: AppUrlEnv = process.env,
): string {
  return (
    mercadoLivreRedirectUriCandidates(request, env)[0] ??
    `${LOCAL_FALLBACK_BASE_URL}${MERCADOLIVRE_CALLBACK_PATH}`
  );
}

/** Back-compatible alias of `resolveMercadoLivreRedirectUri()`. */
export function getMercadoLivreRedirectUri(): string {
  return resolveMercadoLivreRedirectUri();
}

/** Seller authorization URL (official OAuth2, CSRF `state` supported). */
export function buildMercadoLivreAuthorizationUrl(
  state: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
  request?: RedirectRequestContext,
): string {
  const url = new URL("/authorization", config.authBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", resolveMercadoLivreRedirectUri(request));
  url.searchParams.set("state", state);
  return url.toString();
}

export interface MercadoLivreTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  userId: string;
}

interface MeliTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: number;
  token_type?: string;
  error?: string;
  message?: string;
}

async function meliTokenRequest(
  config: MercadoLivreConfig,
  form: Record<string, string>,
): Promise<MercadoLivreTokenSet> {
  const url = new URL("/oauth/token", config.apiBaseUrl);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...form,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Livre.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as MeliTokenResponse | undefined;
  if (!response.ok || !payload?.access_token || !payload.refresh_token || !payload.expires_in) {
    const status = response.status || 502;
    throw new ProviderApiError(
      payload?.message || payload?.error || "O Mercado Livre rejeitou a troca de token.",
      status,
      PROVIDER,
      // A rejected grant is never fixed by retrying — only by authorizing
      // the account again (the panel turns this into the connect CTA).
      // Rate limits and outages stay retryable.
      { requiresReauth: status < 500 && status !== 429 },
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    userId: payload.user_id !== undefined ? String(payload.user_id) : "",
  };
}

/**
 * Is this failure Meli saying "that is not the redirect_uri I expected"?
 *
 * Meli answers an `invalid_grant` for BOTH a consumed/expired code and a
 * redirect URI mismatch, without distinguishing them, so the exchange simply
 * tries the next candidate: at worst that is one extra 400 in the logs.
 */
function isRedirectUriRejection(error: unknown): boolean {
  if (!(error instanceof ProviderApiError)) return false;
  if (error.status >= 500 || error.status === 429) return false;
  return error.status === 400 || error.status === 401;
}

export interface MercadoLivreExchangeOptions {
  /** The inbound callback request — recovers the real `redirect_uri`. */
  request?: RedirectRequestContext;
  /** Explicit candidate list (tests and callers that already resolved it). */
  redirectUris?: string[];
}

/**
 * Exchange the authorization `code` for tokens (official code grant).
 *
 * Every resolved redirect URI is attempted in precedence order until Meli
 * accepts one, so a deployment whose `APP_URL` does not match the DevCenter
 * registration still completes the connection instead of leaving the tenant
 * with a stale token. The attempted URI is logged (never the code or the
 * secret) so Render's logs name the value to register.
 */
export async function exchangeMercadoLivreCode(
  code: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
  options: MercadoLivreExchangeOptions = {},
): Promise<MercadoLivreTokenSet> {
  const candidates =
    options.redirectUris?.filter(Boolean) ?? mercadoLivreRedirectUriCandidates(options.request);
  const redirectUris = candidates.length > 0 ? candidates : [resolveMercadoLivreRedirectUri()];

  let firstError: unknown;
  for (const [index, redirectUri] of redirectUris.entries()) {
    try {
      return await meliTokenRequest(config, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      });
    } catch (error) {
      firstError ??= error;
      const isLast = index === redirectUris.length - 1;
      if (isLast || !isRedirectUriRejection(error)) throw error;
      console.warn(
        "[mercadolivre.oauth.exchange] redirect_uri rejeitado, tentando o próximo candidato",
        {
          attempted: redirectUri,
          next: redirectUris[index + 1],
          status: error instanceof ProviderApiError ? error.status : undefined,
        },
      );
    }
  }
  throw (
    firstError ?? new ProviderApiError("O Mercado Livre rejeitou a troca de token.", 502, PROVIDER)
  );
}

/** Rotate an expired token (Meli access tokens live ≈6 hours). */
export async function refreshMercadoLivreToken(
  refreshToken: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<MercadoLivreTokenSet> {
  return meliTokenRequest(config, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

// ------------------------------------------------------------------
// Authorization guard + error translation (PR016.1)
// ------------------------------------------------------------------

/** Is this a usable Meli access token? (presence check, never validity) */
export function hasMercadoLivreAuthorization(
  accessToken: string | null | undefined,
  userId?: string | null,
): boolean {
  return Boolean(accessToken?.trim()) && (userId === undefined || Boolean(userId?.trim()));
}

/**
 * Refuse to call the Meli API without a credential.
 *
 * Calling `/users/{id}/items/search` with an empty bearer returns a generic
 * 401 that surfaced as "Não foi possível listar os anúncios do Mercado
 * Livre" — a dead end for an operator who has simply never authorized the
 * account. The guard fails first, with the CTA in the message.
 */
export function assertMercadoLivreAuthorization(
  accessToken: string | null | undefined,
  userId?: string | null,
): asserts accessToken is string {
  if (hasMercadoLivreAuthorization(accessToken, userId)) return;
  throw new ConnectorReauthRequiredError(
    PROVIDER,
    `A conta do Mercado Livre ainda não foi autorizada. Clique em "${MERCADOLIVRE_CONNECT_CTA}" para liberar o acesso aos seus anúncios.`,
  );
}

interface MeliErrorPayload {
  message?: string;
  error?: string;
  status?: number;
}

/**
 * Translate a Meli HTTP failure into a typed, actionable domain error.
 *
 * 401/403 are the ones that matter: the token was revoked in "Minha conta →
 * Aplicações", it expired without a usable refresh token, or it belongs to a
 * different seller than `shopId`. All three are only fixable by authorizing
 * again, so they become `ConnectorReauthRequiredError` and the panel shows
 * the connect button instead of a retry that can never succeed.
 */
function meliApiError(
  context: string,
  status: number,
  payload: MeliErrorPayload | undefined,
): ProviderApiError | ConnectorReauthRequiredError {
  const detail = payload?.message || payload?.error;
  if (status === 401) {
    return new ConnectorReauthRequiredError(
      PROVIDER,
      `A autorização do Mercado Livre expirou ou foi revogada. Clique em "${MERCADOLIVRE_CONNECT_CTA}" para reautenticar o canal.`,
      { cause: detail },
    );
  }
  if (status === 403) {
    return new ConnectorReauthRequiredError(
      PROVIDER,
      `O Mercado Livre recusou o acesso a esta conta (permissão insuficiente ou token de outro vendedor). Clique em "${MERCADOLIVRE_CONNECT_CTA}" para reautenticar o canal.`,
      { cause: detail },
    );
  }
  if (status === 429) {
    return new ProviderApiError(
      "O Mercado Livre limitou temporariamente as requisições (rate limit). Tente sincronizar novamente em alguns minutos.",
      429,
      PROVIDER,
    );
  }
  if (status >= 500) {
    return new ProviderApiError(
      "O Mercado Livre está instável no momento. Nenhuma credencial foi perdida — tente sincronizar novamente em instantes.",
      status,
      PROVIDER,
    );
  }
  return new ProviderApiError(detail ? `${context} (${detail})` : context, status || 502, PROVIDER);
}

/** One authenticated GET against the Meli API, with typed failures. */
async function meliAuthorizedGet(
  url: URL,
  accessToken: string,
  context: string,
): Promise<{ status: number; payload: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Livre.", 503, PROVIDER);
  }
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    throw meliApiError(context, response.status, payload as MeliErrorPayload | undefined);
  }
  return { status: response.status, payload };
}

interface MeliUser {
  id?: number;
  nickname?: string;
  site_id?: string;
}

/** Seller identity (`/users/me`) — non-secret data stored on the Connector. */
export async function fetchMercadoLivreIdentity(
  accessToken: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<{ userId: string; nickname: string | null; siteId: string | null }> {
  assertMercadoLivreAuthorization(accessToken);
  const { payload } = await meliAuthorizedGet(
    new URL("/users/me", config.apiBaseUrl),
    accessToken,
    "Não foi possível identificar a conta do vendedor no Mercado Livre.",
  );
  const user = payload as MeliUser | undefined;
  if (user?.id === undefined) {
    throw new ProviderApiError(
      "Não foi possível identificar a conta do vendedor no Mercado Livre.",
      502,
      PROVIDER,
    );
  }
  return {
    userId: String(user.id),
    nickname: user.nickname ?? null,
    siteId: user.site_id ?? null,
  };
}

interface MeliItemSearchResponse {
  results?: string[];
}

// ------------------------------------------------------------------
// Orders — webhook sale ingestion (PR014 — Motor Financeiro Unificado)
// ------------------------------------------------------------------

export interface MeliOrder {
  id: string;
  /** Meli order status: payment_required · payment_in_process · paid · … */
  status: string;
  /** Order grand total in currency units (decimal, e.g. 189.9). */
  totalAmountCents: number;
  currencyId: string;
  dateCreated: Date;
  dateClosed: Date | null;
  buyerNickname: string | null;
  itemCount: number;
}

interface MeliOrderResponse {
  id?: number;
  status?: string;
  order_status?: string;
  total_amount?: number;
  currency_id?: string;
  date_created?: string;
  date_closed?: string | null;
  item_count?: number;
  buyer?: { nickname?: string };
  payments?: Array<{
    status?: string;
    transaction_amount?: number;
  }>;
}

/** Parse a decimal amount into integer cents, clamping malformed input. */
function toCents(amount: number | null | undefined): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

/**
 * Fetch one order by id (`GET /orders/{id}`) — the resource referenced by
 * `orders` / `orders_v2` webhook notifications. The tenant's access token
 * must belong to the seller of the order (resolved by the ingestion worker).
 */
export async function fetchMercadoLivreOrder(
  accessToken: string,
  orderId: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<MeliOrder> {
  assertMercadoLivreAuthorization(accessToken);
  const url = new URL(`/orders/${encodeURIComponent(orderId)}`, config.apiBaseUrl);
  const { payload: raw } = await meliAuthorizedGet(
    url,
    accessToken,
    `Não foi possível obter o pedido ${orderId} do Mercado Livre.`,
  );
  const payload = raw as (MeliOrderResponse & { message?: string }) | undefined;
  if (payload?.id === undefined) {
    throw new ProviderApiError(
      `Não foi possível obter o pedido ${orderId} do Mercado Livre.`,
      502,
      PROVIDER,
    );
  }

  // A partially paid order already carries approved Meli payments; revenue
  // attribution uses the effective paid amount, never the pending total.
  const approvedPaymentsTotal = (payload.payments ?? [])
    .filter((payment) => payment.status === "approved")
    .reduce((sum, payment) => sum + toCents(payment.transaction_amount), 0);
  const orderTotalCents = toCents(payload.total_amount);

  return {
    id: String(payload.id),
    status: payload.status ?? "unknown",
    totalAmountCents: approvedPaymentsTotal > 0 ? approvedPaymentsTotal : orderTotalCents,
    currencyId: payload.currency_id ?? "BRL",
    dateCreated: payload.date_created ? new Date(payload.date_created) : new Date(),
    dateClosed: payload.date_closed ? new Date(payload.date_closed) : null,
    buyerNickname: payload.buyer?.nickname ?? null,
    itemCount: Math.max(1, Math.trunc(Number(payload.item_count ?? 1)) || 1),
  };
}

/** Map a Meli order status onto the `Sale` lifecycle. */
export function meliOrderStatusToSaleStatus(status: string): "PAID" | "PENDING" | "CANCELLED" {
  switch (status) {
    case "paid":
    case "partially_paid":
    case "shipped":
    case "delivered":
      return "PAID";
    case "cancelled":
      return "CANCELLED";
    default:
      // payment_required · payment_in_process · confirmed · …
      return "PENDING";
  }
}

interface MeliItemsBatchEntry {
  code?: number;
  body?: {
    id?: string;
    title?: string;
    permalink?: string;
    thumbnail?: string;
    price?: number;
    currency_id?: string;
    sold_quantity?: number;
  };
}

/**
 * Fetch the seller's active listings, normalized onto the connector
 * framework contract (PRODUCT items).
 *
 * The authorization guard runs BEFORE the first network call: a workspace
 * that never completed the OAuth flow gets the "Conectar Conta do Mercado
 * Livre" instruction, not a generic listing failure. A 401/403 from Meli is
 * translated into the same actionable error, so a revoked or mismatched
 * token also lands the operator on the reconnect flow.
 */
export async function fetchMercadoLivreItems(
  accessToken: string,
  userId: string,
  limit: number,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<NormalizedContent[]> {
  assertMercadoLivreAuthorization(accessToken, userId);

  const searchUrl = new URL(`/users/${encodeURIComponent(userId)}/items/search`, config.apiBaseUrl);
  searchUrl.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
  searchUrl.searchParams.set("offset", "0");

  const { payload: searchRaw } = await meliAuthorizedGet(
    searchUrl,
    accessToken,
    "Não foi possível listar os anúncios do Mercado Livre.",
  );
  const searchPayload = searchRaw as MeliItemSearchResponse | undefined;
  const ids = (searchPayload?.results ?? []).slice(0, 20); // multiget cap
  if (ids.length === 0) return [];

  const itemsUrl = new URL("/items", config.apiBaseUrl);
  itemsUrl.searchParams.set("ids", ids.join(","));
  const { payload: itemsRaw } = await meliAuthorizedGet(
    itemsUrl,
    accessToken,
    "Não foi possível obter os detalhes dos anúncios do Mercado Livre.",
  );
  const itemsPayload = itemsRaw as MeliItemsBatchEntry[] | undefined;
  if (!Array.isArray(itemsPayload)) {
    throw new ProviderApiError(
      "Não foi possível obter os detalhes dos anúncios do Mercado Livre.",
      502,
      PROVIDER,
    );
  }

  return itemsPayload
    .filter((entry) => entry.code === 200 && entry.body?.id)
    .map((entry) => {
      const item = entry.body!;
      return {
        externalId: `meli:item:${userId}:${item.id}`,
        type: "PRODUCT" as const,
        title: item.title ?? `Anúncio ${item.id}`,
        url: item.permalink,
        thumbnailUrl: item.thumbnail,
        views: item.sold_quantity ?? 0,
        raw: {
          provider: "mercadolivre",
          userId,
          itemId: item.id,
          price: item.price,
          currency: item.currency_id,
        },
      };
    });
}
