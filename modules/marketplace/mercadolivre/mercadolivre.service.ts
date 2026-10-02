import "server-only";

import {
  ConnectorConfigError,
  ConnectorReauthRequiredError,
  ProviderApiError,
} from "../core/errors";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import {
  listUnifiedRedirectUriCandidates,
  resolveUnifiedRedirectUri,
  UNIFIED_CALLBACK_PATH,
} from "@/modules/connectors/core/connector.service";
import type { AppUrlEnv } from "@/lib/app-url";

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
 * REDIRECT URI CONTRACT (PR016.2)
 * -------------------------------
 * Meli validates `redirect_uri` TWICE — once on `/authorization` and once on
 * the code exchange, where the two values must be byte-identical and must
 * match the URI registered in DevCenter. The value is now STATIC: it is
 * resolved exclusively from the environment by the connector configuration
 * service (`modules/connectors/core/connector.service.ts`), which accepts
 * BOTH `MERCADOLIVRE_REDIRECT_URI` and `MERCADOPAGO_REDIRECT_URI` — the
 * unified ecosystem callback the director pinned on Render. NOTHING is
 * derived from the inbound request anymore (no `X-Forwarded-Host`, no
 * `request.url`): the authorization URL and the token exchange read the
 * exact same constant, so the two legs cannot diverge by construction.
 */

const MELI_API_BASE_URL = "https://api.mercadolibre.com";
const MELI_AUTH_BASE_URL = "https://auth.mercadolivre.com.br";
const PROVIDER = "MERCADOLIVRE" as const;

/** Canonical callback path of this application (unified ecosystem handler). */
export const MERCADOLIVRE_CALLBACK_PATH = UNIFIED_CALLBACK_PATH;

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

/**
 * Every redirect URI this deployment may legitimately present to Meli, in
 * precedence order and de-duplicated — ALL of them static (environment
 * only, resolved by the connector configuration service):
 *
 * 1. `MERCADOLIVRE_REDIRECT_URI` / `MERCADOPAGO_REDIRECT_URI` — the
 *    operator's explicit pin of the unified ecosystem callback (Render).
 * 2. `APP_URL`, then `NEXTAUTH_URL` — the configured public base plus the
 *    canonical callback path.
 * 3. `http://localhost:3000` — local development only.
 *
 * PR016.2 removed the request-derived candidate: recomputing the
 * `redirect_uri` from the callback's own headers is what made the
 * authorization leg and the exchange leg diverge behind Render's proxy.
 */
export function mercadoLivreRedirectUriCandidates(env: AppUrlEnv = process.env): string[] {
  return listUnifiedRedirectUriCandidates(env);
}

/**
 * The redirect URI to present to Mercado Livre — the first static
 * candidate.
 *
 * It MUST be registered verbatim in DevCenter
 * (developers.mercadolivre.com.br → your application → Redirect URI).
 */
export function resolveMercadoLivreRedirectUri(env: AppUrlEnv = process.env): string {
  return resolveUnifiedRedirectUri(env);
}

/** Back-compatible alias of `resolveMercadoLivreRedirectUri()`. */
export function getMercadoLivreRedirectUri(): string {
  return resolveMercadoLivreRedirectUri();
}

/**
 * Normalize the public application identifier before it reaches Meli.
 *
 * Environment dashboards commonly preserve accidental whitespace and a
 * copied trailing slash. Mercado Livre compares this value strictly, so the
 * authorization request uses one canonical, lower-case identifier. The
 * secret is deliberately never normalized here.
 */
function normalizeAuthorizationClientId(clientId: string): string {
  return clientId.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Seller authorization URL for a private/in-house Mercado Livre application.
 *
 * Mercado Livre's owner-account flow derives permissions from the application
 * configuration in DevCenter. Sending `scope` (including `offline_access`)
 * opts into public/third-party permission validation and can trigger the
 * yellow commercial-homologation rejection screen. Keep the authorization
 * request deliberately strict: protocol fields plus the one-time CSRF state.
 * Refresh-token issuance remains part of the authorization-code exchange.
 *
 * The `redirect_uri` is the STATIC unified value — the same constant the
 * code exchange replays (PR016.2), so Meli's byte-identical requirement is
 * satisfied by construction.
 */
export function buildMercadoLivreAuthorizationUrl(
  state: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): string {
  const url = new URL("/authorization", config.authBaseUrl.trim().toLowerCase());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", normalizeAuthorizationClientId(config.clientId));
  url.searchParams.set("redirect_uri", resolveMercadoLivreRedirectUri());
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
  error_description?: string;
  message?: string;
  cause?: unknown;
}

function parseMeliTokenResponse(rawBody: string): MeliTokenResponse | undefined {
  if (!rawBody) return undefined;
  try {
    return JSON.parse(rawBody) as MeliTokenResponse;
  } catch {
    return undefined;
  }
}

function logMeliTokenRejection(response: Response, rawBody: string, redirectUri?: string): void {
  console.error("[mercadolivre.oauth.token] resposta rejeitada pelo Mercado Livre", {
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    // The STATIC redirect URI this deployment replayed — the value to
    // register verbatim in DevCenter when Meli rejects the grant.
    ...(redirectUri ? { redirectUri } : {}),
    // Never print a HTTP-200 payload: even an incomplete successful response
    // may contain a live access token. Non-2xx bodies contain Meli's exact
    // rejection and are required for DevCenter diagnosis.
    rawBody: response.ok ? "[omitted: response may contain credentials]" : rawBody,
  });
}

async function meliTokenRequest(
  config: MercadoLivreConfig,
  form: Record<string, string>,
  redirectUri?: string,
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
  const rawBody = await response.text().catch(() => "");
  const payload = parseMeliTokenResponse(rawBody);
  if (!response.ok || !payload?.access_token || !payload.refresh_token || !payload.expires_in) {
    logMeliTokenRejection(response, rawBody, redirectUri);
    const status = response.status || 502;
    throw new ProviderApiError(
      payload?.error_description ||
        payload?.message ||
        payload?.error ||
        "O Mercado Livre rejeitou a troca de token.",
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

export interface MercadoLivreExchangeOptions {
  /**
   * Explicit redirect URI override (tests, or a caller that already resolved
   * the static value). Production calls omit it and read the STATIC unified
   * redirect URI — `MERCADOLIVRE_REDIRECT_URI` / `MERCADOPAGO_REDIRECT_URI`.
   */
  redirectUri?: string;
}

/**
 * Exchange the authorization `code` for tokens (official code grant).
 *
 * PR016.2 — the exchange replays the STATIC unified redirect URI, the same
 * constant `buildMercadoLivreAuthorizationUrl()` sent on `/authorization`.
 * There is NO request-derived computation anymore (no candidate probing
 * from `X-Forwarded-Host`/`request.url`): Meli's byte-identical
 * requirement is satisfied by construction, and a rejected grant names the
 * one value to register in DevCenter (it is logged, never the code or the
 * secret).
 */
export async function exchangeMercadoLivreCode(
  code: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
  options: MercadoLivreExchangeOptions = {},
): Promise<MercadoLivreTokenSet> {
  const redirectUri = options.redirectUri ?? resolveMercadoLivreRedirectUri();
  return meliTokenRequest(
    config,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    },
    redirectUri,
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

interface MeliRelatedResourceResponse {
  order_id?: number | string;
  order?: { id?: number | string };
  orders?: Array<{ id?: number | string }>;
}

type MeliNotificationResource = "orders" | "payments" | "collections" | "shipments";

function resourceReference(
  resource: string,
  allowedSegments: readonly MeliNotificationResource[],
): { segment: MeliNotificationResource; id: string } | null {
  const match = /^\/(orders|payments|collections|shipments)\/([^/?#]+)/i.exec(resource.trim());
  if (!match?.[1] || !match[2]) return null;
  const segment = match[1].toLowerCase() as MeliNotificationResource;
  return allowedSegments.includes(segment) ? { segment, id: match[2] } : null;
}

/**
 * Resolve every sale-related Mercado Livre notification to its canonical
 * order id. `payments` and `shipments` point to their own resources, so the
 * worker follows that resource through the official API before fetching the
 * authoritative order. `items` intentionally returns null: a listing change
 * is captured by the worker but cannot create revenue without an order.
 */
export async function resolveMercadoLivreNotificationOrderId(
  accessToken: string,
  topic: string,
  resource: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<string | null> {
  const normalizedTopic = topic.trim().toLowerCase();
  if (normalizedTopic === "orders" || normalizedTopic === "orders_v2") {
    return resourceReference(resource, ["orders"])?.id ?? null;
  }
  if (normalizedTopic === "items") return null;

  const reference =
    normalizedTopic === "payments"
      ? resourceReference(resource, ["payments", "collections"])
      : normalizedTopic === "shipments"
        ? resourceReference(resource, ["shipments"])
        : null;
  if (!reference) return null;

  assertMercadoLivreAuthorization(accessToken);
  const url = new URL(
    `/${reference.segment}/${encodeURIComponent(reference.id)}`,
    config.apiBaseUrl,
  );
  const { payload: raw } = await meliAuthorizedGet(
    url,
    accessToken,
    `Não foi possível resolver ${reference.segment}/${reference.id} do Mercado Livre.`,
  );
  const payload = raw as MeliRelatedResourceResponse | undefined;
  const orderId = payload?.order?.id ?? payload?.order_id ?? payload?.orders?.[0]?.id;
  return orderId === undefined || orderId === null ? null : String(orderId);
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
