import "server-only";

import { ConnectorConfigError, ProviderApiError } from "../core/errors";
import { hmacSha256Hex } from "../core/crypto.service";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";

/**
 * Shopee Open Platform v2 (PR012) — official partner API, server-side ONLY.
 *
 * Implements the documented HMAC-SHA256 signing scheme:
 *   baseString = partner_id + path + timestamp [+ access_token + shop_id]
 *   sign       = HMAC-SHA256(partner_key, baseString)
 *
 * Flow: buildShopeeAuthorizationUrl() → seller authorizes →
 * /api/shopee/callback receives (code, shop_id) → exchangeShopeeCode()
 * persists encrypted tokens on the unified Connector model.
 *
 * NOTE on CSRF: the Shopee seller-authorization redirect does NOT carry a
 * `state` parameter, so tenant binding on the callback is enforced by the
 * authenticated ADMIN session instead (the callback route requires one) —
 * see app/api/shopee/callback/route.ts.
 */

const SHOPEE_API_BASE_URL = "https://partner.shopeemobile.com";
const PROVIDER = "SHOPEE" as const;

export interface ShopeeConfig {
  partnerId: number;
  partnerKey: string;
  apiBaseUrl: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConnectorConfigError(name, PROVIDER);
  return value;
}

/** Server-only config; the partner key never leaves this module. */
export function getShopeeConfig(): ShopeeConfig {
  const partnerIdRaw = requiredEnv("SHOPEE_PARTNER_ID");
  const partnerId = Number(partnerIdRaw);
  if (!Number.isInteger(partnerId) || partnerId <= 0) {
    throw new ConnectorConfigError("SHOPEE_PARTNER_ID", PROVIDER);
  }
  return {
    partnerId,
    partnerKey: requiredEnv("SHOPEE_PARTNER_KEY"),
    apiBaseUrl: process.env.SHOPEE_API_BASE_URL?.trim() || SHOPEE_API_BASE_URL,
  };
}

/** The redirect must match the one registered in Shopee Open Platform. */
export function getShopeeRedirectUri(): string {
  const explicit = process.env.SHOPEE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXTAUTH_URL?.trim();
  if (!appUrl) throw new ConnectorConfigError("NEXTAUTH_URL", PROVIDER);
  return `${appUrl.replace(/\/$/, "")}/api/shopee/callback`;
}

/**
 * Official Shopee v2 signature. `accessToken` and `shopId` are appended to
 * the base string ONLY for authenticated API calls (never for auth URLs).
 */
export function shopeeSign(
  config: ShopeeConfig,
  path: string,
  timestamp: number,
  extras: { accessToken?: string; shopId?: string | number } = {},
): string {
  const baseString =
    `${config.partnerId}${path}${timestamp}` +
    (extras.accessToken ?? "") +
    (extras.shopId !== undefined ? String(extras.shopId) : "");
  return hmacSha256Hex(config.partnerKey, baseString);
}

/** Seller authorization URL (Open Platform v2). */
export function buildShopeeAuthorizationUrl(config: ShopeeConfig = getShopeeConfig()): string {
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(path, config.apiBaseUrl);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", shopeeSign(config, path, timestamp));
  url.searchParams.set("redirect", getShopeeRedirectUri());
  return url.toString();
}

export interface ShopeeTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

interface ShopeeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
  error?: string;
  message?: string;
  request_id?: string;
}

async function shopeePost<T>(
  config: ShopeeConfig,
  path: string,
  body: Record<string, unknown>,
  extras: { accessToken?: string; shopId?: string | number } = {},
): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(path, config.apiBaseUrl);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("sign", shopeeSign(config, path, timestamp, extras));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar a Shopee Open Platform.", 503, PROVIDER);
  }
  // Never propagate raw provider payloads — they may embed seller data.
  const payload = (await response.json().catch(() => undefined)) as
    | (T & { error?: string; message?: string })
    | undefined;
  if (!response.ok || (payload && typeof payload.error === "string" && payload.error !== "")) {
    throw new ProviderApiError(
      payload?.message || "A Shopee Open Platform rejeitou a requisição.",
      response.status || 502,
      PROVIDER,
    );
  }
  return payload as T;
}

/** Exchange the authorization `code` for a shop access/refresh token pair. */
export async function exchangeShopeeCode(
  code: string,
  shopId: string,
  config: ShopeeConfig = getShopeeConfig(),
): Promise<ShopeeTokenSet> {
  const data = await shopeePost<ShopeeTokenResponse>(config, "/api/v2/auth/token/get", {
    code,
    shop_id: Number(shopId),
    partner_id: config.partnerId,
  });
  if (!data.access_token || !data.refresh_token || !data.expire_in) {
    throw new ProviderApiError(
      "A Shopee não retornou um par de tokens válido.",
      502,
      PROVIDER,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expire_in * 1000),
  };
}

/** Rotate an expired Shopee access token (official refresh endpoint). */
export async function refreshShopeeToken(
  refreshToken: string,
  shopId: string,
  config: ShopeeConfig = getShopeeConfig(),
): Promise<ShopeeTokenSet> {
  const data = await shopeePost<ShopeeTokenResponse>(
    config,
    "/api/v2/auth/access_token/get",
    { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: config.partnerId },
    { shopId },
  );
  if (!data.access_token || !data.refresh_token || !data.expire_in) {
    throw new ProviderApiError("A Shopee não renovou o token de acesso.", 502, PROVIDER);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expire_in * 1000),
  };
}

interface ShopeeItemListResponse {
  response?: { item?: Array<{ item_id: number }>; total_count?: number };
}

interface ShopeeItemBaseInfoResponse {
  response?: {
    item_list?: Array<{
      item_id: number;
      item_name?: string;
      image?: { image_url_list?: string[] };
      stock_info_v2?: { summary_info?: { total_reserved_stock?: number } };
    }>;
  };
}

/** Shop display name — non-secret identity stored on the Connector row. */
export async function fetchShopeeShopInfo(
  accessToken: string,
  shopId: string,
  config: ShopeeConfig = getShopeeConfig(),
): Promise<{ shopName: string | null }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const path = "/api/v2/shop/get_shop_info";
  const url = new URL(path, config.apiBaseUrl);
  url.searchParams.set("partner_id", String(config.partnerId));
  url.searchParams.set("timestamp", String(timestamp));
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("shop_id", shopId);
  url.searchParams.set("sign", shopeeSign(config, path, timestamp, { accessToken, shopId }));
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
  const payload = (await response.json().catch(() => undefined)) as
    | { response?: { shop_name?: string } }
    | undefined;
  if (!response.ok) return { shopName: null };
  return { shopName: payload?.response?.shop_name ?? null };
}

/**
 * Fetch the shop's active catalog, normalized onto the connector framework
 * contract (PRODUCT items) so downstream KPIs/dedupe stay provider-agnostic.
 */
export async function fetchShopeeProducts(
  accessToken: string,
  shopId: string,
  limit: number,
  config: ShopeeConfig = getShopeeConfig(),
): Promise<NormalizedContent[]> {
  const pageSize = Math.min(Math.max(limit, 1), 50);
  const listPath = "/api/v2/product/get_item_list";
  const timestamp = Math.floor(Date.now() / 1000);
  const listUrl = new URL(listPath, config.apiBaseUrl);
  listUrl.searchParams.set("partner_id", String(config.partnerId));
  listUrl.searchParams.set("timestamp", String(timestamp));
  listUrl.searchParams.set("access_token", accessToken);
  listUrl.searchParams.set("shop_id", shopId);
  listUrl.searchParams.set("offset", "0");
  listUrl.searchParams.set("page_size", String(pageSize));
  listUrl.searchParams.set("item_status", "NORMAL");
  listUrl.searchParams.set(
    "sign",
    shopeeSign(config, listPath, timestamp, { accessToken, shopId }),
  );

  const listResponse = await fetch(listUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const listPayload = (await listResponse.json().catch(() => undefined)) as
    | (ShopeeItemListResponse & { error?: string; message?: string })
    | undefined;
  if (!listResponse.ok || (listPayload && listPayload.error)) {
    throw new ProviderApiError(
      listPayload?.message || "Não foi possível listar os produtos da Shopee.",
      listResponse.status || 502,
      PROVIDER,
    );
  }
  const itemIds = (listPayload?.response?.item ?? []).map((item) => item.item_id);
  if (itemIds.length === 0) return [];

  const infoPath = "/api/v2/product/get_item_base_info";
  const infoTimestamp = Math.floor(Date.now() / 1000);
  const infoUrl = new URL(infoPath, config.apiBaseUrl);
  infoUrl.searchParams.set("partner_id", String(config.partnerId));
  infoUrl.searchParams.set("timestamp", String(infoTimestamp));
  infoUrl.searchParams.set("access_token", accessToken);
  infoUrl.searchParams.set("shop_id", shopId);
  infoUrl.searchParams.set("item_id_list", itemIds.join(","));
  infoUrl.searchParams.set(
    "sign",
    shopeeSign(config, infoPath, infoTimestamp, { accessToken, shopId }),
  );
  const infoResponse = await fetch(infoUrl, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const infoPayload = (await infoResponse.json().catch(() => undefined)) as
    | (ShopeeItemBaseInfoResponse & { error?: string; message?: string })
    | undefined;
  if (!infoResponse.ok || (infoPayload && infoPayload.error)) {
    throw new ProviderApiError(
      infoPayload?.message || "Não foi possível obter os detalhes dos produtos Shopee.",
      infoResponse.status || 502,
      PROVIDER,
    );
  }

  return (infoPayload?.response?.item_list ?? []).map((item) => ({
    externalId: `shopee:item:${shopId}:${item.item_id}`,
    type: "PRODUCT",
    title: item.item_name ?? `Item Shopee ${item.item_id}`,
    thumbnailUrl: item.image?.image_url_list?.[0],
    raw: {
      provider: "shopee",
      shopId,
      itemId: item.item_id,
    },
  }));
}

/**
 * Official Shopee push verification: the platform signs
 * `webhook_url + raw_body` with the partner key and sends the hex digest in
 * the `Authorization` header.
 */
export function verifyShopeeWebhookSignature(
  rawBody: string,
  webhookUrl: string,
  authorizationHeader: string | null,
  config: ShopeeConfig = getShopeeConfig(),
): boolean {
  if (!authorizationHeader) return false;
  const expected = hmacSha256Hex(config.partnerKey, `${webhookUrl}${rawBody}`);
  return expected === authorizationHeader.trim();
}
