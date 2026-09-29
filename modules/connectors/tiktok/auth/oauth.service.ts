import "server-only";

import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, TikTokAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import { TIKTOK_AUTH_BASE_URL, TikTokApiClient, getTikTokApiConfig } from "../api/client";
import {
  createTikTokTokenRepository,
  decryptAccountTokens,
  hashOAuthState,
  tiktokTokenRepository,
  type TikTokTokenSet,
  type TikTokTokenDatabase,
} from "./token.service";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

export class TikTokOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokOAuthError";
  }
}

interface TikTokTokenResponseData {
  access_token?: string;
  refresh_token?: string;
  access_token_expire_in?: number | string;
  expires_in?: number | string;
  refresh_token_expire_in?: number | string;
  open_id?: string;
  seller_id?: string | number;
}

interface TikTokTokenResponse {
  code?: number;
  message?: string;
  data?: TikTokTokenResponseData;
}

interface AuthorizedShop {
  id?: string | number;
  shop_id?: string | number;
  cipher?: string;
  shop_cipher?: string;
  name?: string;
  shop_name?: string;
  seller_id?: string | number;
}

export type TikTokOAuthDatabase = TikTokTokenDatabase &
  Pick<PrismaClient, "tikTokOAuthState" | "auditLog">;

export interface TikTokOAuthDependencies {
  db?: TikTokOAuthDatabase;
  fetch?: typeof fetch;
  now?: () => Date;
  randomState?: () => string;
  apiClient?: (config: ReturnType<typeof getTikTokApiConfig>) => TikTokApiClient;
}

function required(name: "TIKTOK_APP_KEY" | "TIKTOK_APP_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TikTokOAuthError(`${name} is required to use the TikTok Shop connector.`);
  return value;
}

/** The redirect must match the one registered in TikTok Shop Partner Center. */
export function getTikTokRedirectUri(): string {
  const explicit = process.env.TIKTOK_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXTAUTH_URL?.trim();
  if (!appUrl) {
    throw new TikTokOAuthError(
      "NEXTAUTH_URL (or TIKTOK_REDIRECT_URI) is required to construct the TikTok OAuth callback URL.",
    );
  }
  return `${appUrl.replace(/\/$/, "")}/api/tiktok/callback`;
}

function getSellerAuthorizationUrl(state: string): string {
  const configured =
    process.env.TIKTOK_SELLER_AUTH_URL?.trim() || "https://services.tiktokshop.com/open/authorize";
  const url = new URL(configured);
  // Seller OAuth calls this parameter service_id (the TikTok Shop app key).
  url.searchParams.set("service_id", required("TIKTOK_APP_KEY"));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", getTikTokRedirectUri());
  return url.toString();
}

function parseExpiry(data: TikTokTokenResponseData, now: Date): Date {
  const raw = data.access_token_expire_in ?? data.expires_in;
  const seconds = typeof raw === "string" ? Number(raw) : raw;
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    throw new TikTokOAuthError(
      "TikTok Shop token response did not include a valid access token expiry.",
    );
  }
  return new Date(now.getTime() + seconds * 1000);
}

function parseTokenSet(data: TikTokTokenResponseData, now: Date): TikTokTokenSet {
  if (!data.access_token || !data.refresh_token) {
    throw new TikTokOAuthError(
      "TikTok Shop token response did not include both access and refresh tokens.",
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: parseExpiry(data, now),
  };
}

async function requestToken(
  params: Record<string, string>,
  doFetch: typeof fetch,
  path = "/api/v2/token/get",
): Promise<TikTokTokenResponseData> {
  const url = new URL(path, process.env.TIKTOK_AUTH_BASE_URL?.trim() || TIKTOK_AUTH_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await doFetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new TikTokOAuthError("Unable to reach TikTok Shop token service.");
  }
  const text = await response.text();
  let body: TikTokTokenResponse | undefined;
  try {
    body = JSON.parse(text) as TikTokTokenResponse;
  } catch {
    throw new TikTokOAuthError("TikTok Shop token service returned an invalid response.");
  }
  if (!response.ok || body.code !== 0 || !body.data) {
    // Do not expose raw API response because it may contain sensitive provider metadata.
    throw new TikTokOAuthError(body.message || "TikTok Shop rejected the token request.");
  }
  return body.data;
}

function toAuthorizedShop(
  value: AuthorizedShop,
  fallbackSellerId?: string,
): {
  shopId: string;
  shopCipher: string;
  shopName?: string;
  sellerId?: string;
} | null {
  const id = value.id ?? value.shop_id;
  const cipher = value.cipher ?? value.shop_cipher;
  if (id === undefined || !cipher) return null;
  return {
    shopId: String(id),
    shopCipher: cipher,
    shopName: value.name ?? value.shop_name,
    sellerId: value.seller_id === undefined ? fallbackSellerId : String(value.seller_id),
  };
}

/**
 * Server-only OAuth lifecycle. The state is random, hashed at rest, expires
 * in ten minutes and is consumed exactly once before a code is exchanged.
 */
export function createTikTokOAuthService(deps: TikTokOAuthDependencies = {}) {
  const db = deps.db ?? prisma;
  // Injected test databases must be used for account writes too; production
  // uses the app singleton and never touches a browser-visible data source.
  const tokenRepository = deps.db ? createTikTokTokenRepository(db) : tiktokTokenRepository;
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));
  const makeClient = deps.apiClient ?? ((config) => new TikTokApiClient(config));

  return {
    async connectTikTok(organizationId: string): Promise<{ authorizationUrl: string }> {
      const scope = tenantWhere(organizationId);
      const state = randomState();
      const current = now();
      await db.tikTokOAuthState.deleteMany({
        where: { organizationId: scope.organizationId, expiresAt: { lte: current } },
      });
      await db.tikTokOAuthState.create({
        data: {
          organizationId: scope.organizationId,
          stateHash: hashOAuthState(state),
          expiresAt: new Date(current.getTime() + OAUTH_STATE_TTL_MS),
        },
      });
      return { authorizationUrl: getSellerAuthorizationUrl(state) };
    },

    async exchangeCode(input: { code: string; state: string }): Promise<TikTokAccount[]> {
      const current = now();
      const stateHash = hashOAuthState(input.state);
      const stored = await db.tikTokOAuthState.findUnique({ where: { stateHash } });
      if (!stored || stored.expiresAt <= current) {
        if (stored) await db.tikTokOAuthState.deleteMany({ where: { id: stored.id } });
        throw new TikTokOAuthError(
          "TikTok authorization state is invalid or expired. Start the connection again.",
        );
      }
      const consumed = await db.tikTokOAuthState.deleteMany({
        where: { id: stored.id, expiresAt: { gt: current } },
      });
      if (consumed.count !== 1) {
        throw new TikTokOAuthError("TikTok authorization state has already been used.");
      }

      const tokenData = await requestToken(
        {
          app_key: required("TIKTOK_APP_KEY"),
          app_secret: required("TIKTOK_APP_SECRET"),
          auth_code: input.code,
          grant_type: "authorized_code",
        },
        doFetch,
      );
      const tokenSet = parseTokenSet(tokenData, current);
      const apiConfig = getTikTokApiConfig();
      const client = makeClient(apiConfig);
      const shopsResponse = await client.request<{ shops?: AuthorizedShop[] }>({
        path: "/authorization/202309/shops",
        method: "GET",
        accessToken: tokenSet.accessToken,
      });
      const shops = (shopsResponse.shops ?? [])
        .map((shop) =>
          toAuthorizedShop(shop, tokenData.seller_id ? String(tokenData.seller_id) : undefined),
        )
        .filter((shop): shop is NonNullable<typeof shop> => shop !== null);
      if (shops.length === 0) {
        throw new TikTokOAuthError(
          "TikTok authorized no accessible shops for this seller account.",
        );
      }

      const repository = tokenRepository;
      const accounts = await Promise.all(
        shops.map((shop) => repository.upsertAuthorizedShop(stored.organizationId, shop, tokenSet)),
      );
      await db.auditLog.create({
        data: {
          organizationId: stored.organizationId,
          action: "TIKTOK_CONNECTED",
          entityType: "TikTokAccount",
          metadata: { shops: accounts.map((account) => account.shopId) } as Prisma.InputJsonValue,
        },
      });
      return accounts;
    },

    async refreshAccessToken(organizationId: string, accountId: string): Promise<TikTokTokenSet> {
      const repository = tokenRepository;
      const account = await repository.findById(organizationId, accountId);
      if (!account) throw new TikTokOAuthError("TikTok account was not found for this workspace.");
      const { refreshToken } = decryptAccountTokens(account);
      try {
        const tokenData = await requestToken(
          {
            app_key: required("TIKTOK_APP_KEY"),
            app_secret: required("TIKTOK_APP_SECRET"),
            refresh_token: refreshToken,
            grant_type: "refresh_token",
          },
          doFetch,
          "/api/v2/token/refresh",
        );
        const next: TikTokTokenSet = {
          accessToken: tokenData.access_token || "",
          // TikTok rotates refresh tokens. If a legacy response omitted it,
          // retain the current one rather than destroying a valid connection.
          refreshToken: tokenData.refresh_token || refreshToken,
          expiresAt: parseExpiry(tokenData, now()),
        };
        if (!next.accessToken)
          throw new TikTokOAuthError("TikTok refresh response did not include an access token.");
        await repository.saveRefreshedTokens(organizationId, account.id, next);
        return next;
      } catch (error) {
        await repository.markExpired(organizationId, account.id);
        throw error;
      }
    },

    async getValidAccessToken(organizationId: string, account: TikTokAccount): Promise<string> {
      if (
        !account.expiresAt ||
        account.expiresAt.getTime() <= now().getTime() + TOKEN_REFRESH_SKEW_MS
      ) {
        const refreshed = await this.refreshAccessToken(organizationId, account.id);
        return refreshed.accessToken;
      }
      return decryptAccountTokens(account).accessToken;
    },

    async revokeConnection(organizationId: string, accountId: string): Promise<boolean> {
      const repository = tokenRepository;
      const account = await repository.findById(organizationId, accountId);
      if (!account) return false;
      // TikTok Shop deauthorization is controlled in Partner Center. Locally
      // we immediately revoke access by deleting ciphertext, which guarantees
      // this app cannot make another API call with the seller's credentials.
      const disconnected = await repository.disconnect(organizationId, accountId);
      if (disconnected) {
        await db.auditLog.create({
          data: {
            organizationId,
            action: "TIKTOK_DISCONNECTED",
            entityType: "TikTokAccount",
            entityId: accountId,
          },
        });
      }
      return disconnected;
    },
  };
}

export const tiktokOAuthService = createTikTokOAuthService();

/** Public server-side methods required by the connector contract. */
export const connectTikTok = (organizationId: string) =>
  tiktokOAuthService.connectTikTok(organizationId);
export const exchangeCode = (input: { code: string; state: string }) =>
  tiktokOAuthService.exchangeCode(input);
export const refreshAccessToken = (organizationId: string, accountId: string) =>
  tiktokOAuthService.refreshAccessToken(organizationId, accountId);
export const revokeConnection = (organizationId: string, accountId: string) =>
  tiktokOAuthService.revokeConnection(organizationId, accountId);
