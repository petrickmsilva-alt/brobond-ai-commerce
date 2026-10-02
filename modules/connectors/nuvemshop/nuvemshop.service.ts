import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SaleStatus } from "@prisma/client";
import type { NormalizedContent } from "../core/connector.interface";
import {
  ConnectorConfigError,
  ConnectorReauthRequiredError,
  ProviderApiError,
} from "@/modules/marketplace/core/errors";

/**
 * Official Nuvemshop/Tiendanube API client.
 *
 * OAuth credentials and the static redirect URI are read only on the server.
 * Store access tokens are long-lived (no refresh token / expiry) and are
 * encrypted by the marketplace service before persistence.
 */

const PROVIDER = "NUVEMSHOP" as const;
const DEFAULT_AUTH_BASE_URL = "https://www.tiendanube.com";
const DEFAULT_API_BASE_URL = "https://api.tiendanube.com/2025-03";
const ORDER_WEBHOOK_EVENTS = [
  "order/created",
  "order/paid",
  "order/updated",
  "order/cancelled",
] as const;

export interface NuvemshopConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  userAgent: string;
  webhookUrl: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConnectorConfigError(name, PROVIDER);
  return value;
}

/**
 * Static callback configured in the Nuvemshop Partners portal.
 * It is intentionally never derived from an inbound request/forwarded host.
 */
export function getNuvemshopRedirectUri(): string {
  const value = requiredEnv("NUVEMSHOP_REDIRECT_URI");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorConfigError("NUVEMSHOP_REDIRECT_URI", PROVIDER);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new ConnectorConfigError("NUVEMSHOP_REDIRECT_URI", PROVIDER);
  }
  return url.toString();
}

function resolveWebhookUrl(redirectUri: string): string {
  const explicit = process.env.NUVEMSHOP_WEBHOOK_URL?.trim();
  const candidate = explicit || new URL("/api/webhooks/nuvemshop", redirectUri).toString();
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("insecure");
    return url.toString();
  } catch {
    throw new ConnectorConfigError("NUVEMSHOP_WEBHOOK_URL", PROVIDER);
  }
}

export function getNuvemshopConfig(): NuvemshopConfig {
  const clientId = requiredEnv("NUVEMSHOP_CLIENT_ID");
  const redirectUri = getNuvemshopRedirectUri();
  return {
    clientId,
    clientSecret: requiredEnv("NUVEMSHOP_CLIENT_SECRET"),
    redirectUri,
    authBaseUrl: process.env.NUVEMSHOP_AUTH_BASE_URL?.trim() || DEFAULT_AUTH_BASE_URL,
    apiBaseUrl: process.env.NUVEMSHOP_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL,
    userAgent: process.env.NUVEMSHOP_USER_AGENT?.trim() || `Brobond Wear Commerce (${clientId})`,
    webhookUrl: resolveWebhookUrl(redirectUri),
  };
}

/** Authorization-code installation URL, protected by a one-time OAuth state. */
export function buildNuvemshopAuthorizationUrl(
  state: string,
  config: NuvemshopConfig = getNuvemshopConfig(),
): string {
  const url = new URL(`/apps/${encodeURIComponent(config.clientId)}/authorize`, config.authBaseUrl);
  url.searchParams.set("state", state);
  // The application also has this URI registered statically. Sending the
  // exact value makes the two OAuth legs explicit and testable.
  url.searchParams.set("redirect_uri", config.redirectUri);
  return url.toString();
}

interface NuvemshopTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  user_id?: string | number;
  error?: string;
  error_description?: string;
}

export interface NuvemshopTokenSet {
  accessToken: string;
  storeId: string;
  scope: string | null;
}

/**
 * Exchange a short-lived authorization code for Nuvemshop's long-lived
 * access token. `NUVEMSHOP_REDIRECT_URI` is read here again and sent verbatim;
 * request headers can never alter the registered callback identity.
 */
export async function exchangeNuvemshopCode(
  code: string,
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<NuvemshopTokenSet> {
  // Enforce the static environment lock even when tests inject the rest of
  // the config: the exchange may never proceed without the registered URI.
  const redirectUri = config.redirectUri || getNuvemshopRedirectUri();
  let response: Response;
  try {
    response = await fetch(new URL("/apps/authorize/token", config.authBaseUrl), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao trocar o código da Nuvemshop.", 503, PROVIDER);
  }

  const payload = (await response.json().catch(() => undefined)) as
    NuvemshopTokenResponse | undefined;
  if (!response.ok || !payload?.access_token || payload.user_id === undefined) {
    throw new ProviderApiError(
      payload?.error_description ||
        payload?.error ||
        "A Nuvemshop recusou a troca do código OAuth.",
      response.status || 502,
      PROVIDER,
      { requiresReauth: response.status >= 400 && response.status < 500 },
    );
  }

  return {
    accessToken: payload.access_token,
    storeId: String(payload.user_id),
    scope: typeof payload.scope === "string" ? payload.scope : null,
  };
}

function apiUrl(config: NuvemshopConfig, storeId: string, path: string): URL {
  const base = config.apiBaseUrl.replace(/\/$/, "");
  return new URL(`${base}/${encodeURIComponent(storeId)}/${path.replace(/^\//, "")}`);
}

async function nuvemshopRequest<T>(
  accessToken: string,
  storeId: string,
  path: string,
  init: RequestInit = {},
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(apiUrl(config, storeId, path), {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": config.userAgent,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar a API da Nuvemshop.", 503, PROVIDER);
  }

  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ConnectorReauthRequiredError(
        PROVIDER,
        "A autorização da Nuvemshop expirou ou foi revogada. Reconecte a loja para continuar.",
      );
    }
    throw new ProviderApiError(
      response.status === 429
        ? "A Nuvemshop limitou temporariamente as requisições. Tente novamente em alguns minutos."
        : "A API da Nuvemshop rejeitou a requisição.",
      response.status || 502,
      PROVIDER,
    );
  }
  return payload as T;
}

function localized(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["pt", "pt_BR", "pt-BR", "es", "en"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  const first = Object.values(record).find(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0,
  );
  return first?.trim() ?? null;
}

function decimalToCents(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "0").replace(",", "."));
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function asDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

interface NuvemshopProduct {
  id?: string | number;
  name?: unknown;
  description?: unknown;
  handle?: unknown;
  canonical_url?: string;
  published?: boolean;
  created_at?: string;
  updated_at?: string;
  images?: Array<{ src?: string }>;
  variants?: Array<{
    id?: string | number;
    sku?: string | null;
    price?: string | number;
    promotional_price?: string | number | null;
    stock?: number | null;
  }>;
}

export async function fetchNuvemshopProducts(
  accessToken: string,
  storeId: string,
  limit: number,
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<NormalizedContent[]> {
  const perPage = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const products = await nuvemshopRequest<NuvemshopProduct[]>(
    accessToken,
    storeId,
    `products?page=1&per_page=${perPage}&fields=id,name,description,handle,canonical_url,published,created_at,updated_at,images,variants`,
    {},
    config,
  );

  return (Array.isArray(products) ? products : []).flatMap((product) => {
    if (product.id === undefined) return [];
    const productId = String(product.id);
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const primary = variants[0];
    const price = primary?.promotional_price ?? primary?.price ?? 0;
    const stockQuantity = variants.reduce(
      (sum, variant) => sum + Math.max(0, Math.trunc(Number(variant.stock ?? 0)) || 0),
      0,
    );
    const title = localized(product.name) ?? `Produto ${productId}`;
    return [
      {
        externalId: `${storeId}:${productId}`,
        type: "PRODUCT" as const,
        title,
        url: product.canonical_url || undefined,
        thumbnailUrl: product.images?.find((image) => image.src)?.src,
        caption: localized(product.description) ?? undefined,
        publishedAt: asDate(product.created_at),
        views: 0,
        likes: 0,
        shares: 0,
        raw: {
          itemId: productId,
          storeId,
          sku: primary?.sku ?? null,
          price: decimalToCents(price) / 100,
          priceCents: decimalToCents(price),
          currency: "BRL",
          stockQuantity,
          published: product.published ?? false,
          updatedAt: product.updated_at ?? null,
        },
      },
    ];
  });
}

interface NuvemshopStore {
  id?: string | number;
  name?: unknown;
  business_name?: string | null;
}

export async function fetchNuvemshopStore(
  accessToken: string,
  storeId: string,
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<{ storeName: string | null }> {
  const store = await nuvemshopRequest<NuvemshopStore>(accessToken, storeId, "store", {}, config);
  return { storeName: localized(store.name) ?? store.business_name?.trim() ?? null };
}

interface NuvemshopWebhook {
  id?: string | number;
  event?: string;
  url?: string;
}

/** Register every order lifecycle event once for this connected store. */
export async function ensureNuvemshopOrderWebhooks(
  accessToken: string,
  storeId: string,
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<void> {
  const configured = await nuvemshopRequest<NuvemshopWebhook[]>(
    accessToken,
    storeId,
    "webhooks",
    {},
    config,
  );
  const existing = new Set(
    (Array.isArray(configured) ? configured : [])
      .filter((webhook) => webhook.url === config.webhookUrl)
      .map((webhook) => webhook.event),
  );

  await Promise.all(
    ORDER_WEBHOOK_EVENTS.filter((event) => !existing.has(event)).map((event) =>
      nuvemshopRequest<NuvemshopWebhook>(
        accessToken,
        storeId,
        "webhooks",
        { method: "POST", body: JSON.stringify({ event, url: config.webhookUrl }) },
        config,
      ),
    ),
  );
}

/** Verify `x-linkedstore-hmac-sha256` over the exact request bytes. */
export function verifyNuvemshopWebhookSignature(
  rawBody: string,
  signature: string | null,
  clientSecret = process.env.NUVEMSHOP_CLIENT_SECRET?.trim(),
): boolean {
  if (!clientSecret || !signature) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest("base64");
  const actualBuffer = Buffer.from(signature.trim(), "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export interface NuvemshopOrder {
  id: string;
  amountCents: number;
  currency: string;
  status: SaleStatus;
  quantity: number;
  occurredAt: Date;
}

interface NuvemshopOrderPayload {
  id?: string | number;
  total?: string | number;
  currency?: string;
  status?: string;
  payment_status?: string;
  created_at?: string;
  paid_at?: string | null;
  cancelled_at?: string | null;
  products?: Array<{ quantity?: number }>;
}

export function nuvemshopOrderStatusToSaleStatus(
  paymentStatus: string | null | undefined,
  orderStatus?: string | null,
): SaleStatus {
  const payment = paymentStatus?.trim().toLowerCase();
  const order = orderStatus?.trim().toLowerCase();
  // Never book the full order total as paid/refunded for a partial movement.
  // Partial states remain pending/current until a definitive lifecycle event.
  if (payment === "paid") return "PAID";
  if (payment === "refunded") return "REFUNDED";
  if (order === "cancelled" || payment === "voided" || payment === "abandoned") {
    return "CANCELLED";
  }
  return "PENDING";
}

/** Fetch authoritative money/status; webhook payload values are never trusted. */
export async function fetchNuvemshopOrder(
  accessToken: string,
  storeId: string,
  orderId: string,
  config: NuvemshopConfig = getNuvemshopConfig(),
): Promise<NuvemshopOrder> {
  const order = await nuvemshopRequest<NuvemshopOrderPayload>(
    accessToken,
    storeId,
    `orders/${encodeURIComponent(orderId)}`,
    {},
    config,
  );
  if (order.id === undefined) {
    throw new ProviderApiError("A Nuvemshop não retornou um pedido válido.", 502, PROVIDER);
  }
  const quantity = (Array.isArray(order.products) ? order.products : []).reduce(
    (sum, item) => sum + Math.max(1, Math.trunc(Number(item.quantity ?? 1)) || 1),
    0,
  );
  return {
    id: String(order.id),
    amountCents: decimalToCents(order.total),
    currency: order.currency?.trim().toUpperCase() || "BRL",
    status: nuvemshopOrderStatusToSaleStatus(order.payment_status, order.status),
    quantity: Math.max(1, quantity),
    occurredAt:
      asDate(order.paid_at) ?? asDate(order.cancelled_at) ?? asDate(order.created_at) ?? new Date(),
  };
}

export { ORDER_WEBHOOK_EVENTS as NUVEMSHOP_ORDER_WEBHOOK_EVENTS };
