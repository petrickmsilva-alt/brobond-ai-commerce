import "server-only";

import { ConnectorConfigError, ProviderApiError } from "../core/errors";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import { resolveAppBaseUrl } from "@/lib/app-url";

/**
 * Mercado Livre (PR012) — official Meli API, server-side ONLY.
 *
 * Implements the documented OAuth2 flow:
 *   buildMercadoLivreAuthorizationUrl() → auth.mercadolivre.com.br
 *   /api/mercadolivre/callback receives (code, state) →
 *   exchangeMercadoLivreCode() swaps the code for an access/refresh token
 *   pair (POST api.mercadolibre.com/oauth/token), refreshMercadoLivreToken()
 *   rotates it transparently before expiry (6h lifetime).
 */

const MELI_API_BASE_URL = "https://api.mercadolibre.com";
const MELI_AUTH_BASE_URL = "https://auth.mercadolivre.com.br";
const PROVIDER = "MERCADOLIVRE" as const;

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

/** The redirect must match the one registered in the Mercado Livre app. */
export function getMercadoLivreRedirectUri(): string {
  const explicit = process.env.MERCADOLIVRE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  // APP_URL is the canonical Render URL; in local development the explicit
  // URL is normally absent, so use the same origin Next.js listens on.
  const appUrl = resolveAppBaseUrl(process.env) || "http://localhost:3000";
  return `${appUrl}/api/mercadolivre/callback`;
}

/** Seller authorization URL (official OAuth2, CSRF `state` supported). */
export function buildMercadoLivreAuthorizationUrl(
  state: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): string {
  const url = new URL("/authorization", config.authBaseUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", getMercadoLivreRedirectUri());
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
    throw new ProviderApiError(
      payload?.message || "O Mercado Livre rejeitou a troca de token.",
      response.status || 502,
      PROVIDER,
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000),
    userId: payload.user_id !== undefined ? String(payload.user_id) : "",
  };
}

/** Exchange the authorization `code` for tokens (official code grant). */
export async function exchangeMercadoLivreCode(
  code: string,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<MercadoLivreTokenSet> {
  return meliTokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: getMercadoLivreRedirectUri(),
  });
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
  const response = await fetch(new URL("/users/me", config.apiBaseUrl), {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => undefined)) as MeliUser | undefined;
  if (!response.ok || payload?.id === undefined) {
    throw new ProviderApiError(
      "Não foi possível identificar a conta do vendedor no Mercado Livre.",
      response.status || 502,
      PROVIDER,
    );
  }
  return {
    userId: String(payload.id),
    nickname: payload.nickname ?? null,
    siteId: payload.site_id ?? null,
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
  const url = new URL(`/orders/${encodeURIComponent(orderId)}`, config.apiBaseUrl);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Livre.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as
    (MeliOrderResponse & { message?: string }) | undefined;
  if (!response.ok || payload?.id === undefined) {
    throw new ProviderApiError(
      payload?.message || `Não foi possível obter o pedido ${orderId} do Mercado Livre.`,
      response.status || 502,
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
 */
export async function fetchMercadoLivreItems(
  accessToken: string,
  userId: string,
  limit: number,
  config: MercadoLivreConfig = getMercadoLivreConfig(),
): Promise<NormalizedContent[]> {
  const searchUrl = new URL(`/users/${encodeURIComponent(userId)}/items/search`, config.apiBaseUrl);
  searchUrl.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
  searchUrl.searchParams.set("offset", "0");

  const searchResponse = await fetch(searchUrl, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const searchPayload = (await searchResponse.json().catch(() => undefined)) as
    MeliItemSearchResponse | undefined;
  if (!searchResponse.ok) {
    throw new ProviderApiError(
      "Não foi possível listar os anúncios do Mercado Livre.",
      searchResponse.status || 502,
      PROVIDER,
    );
  }
  const ids = (searchPayload?.results ?? []).slice(0, 20); // multiget cap
  if (ids.length === 0) return [];

  const itemsUrl = new URL("/items", config.apiBaseUrl);
  itemsUrl.searchParams.set("ids", ids.join(","));
  const itemsResponse = await fetch(itemsUrl, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const itemsPayload = (await itemsResponse.json().catch(() => undefined)) as
    MeliItemsBatchEntry[] | undefined;
  if (!itemsResponse.ok || !Array.isArray(itemsPayload)) {
    throw new ProviderApiError(
      "Não foi possível obter os detalhes dos anúncios do Mercado Livre.",
      itemsResponse.status || 502,
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
