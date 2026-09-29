import "server-only";

import { randomBytes } from "node:crypto";
import type { DeliveryAccount, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import {
  decryptDeliverySecret,
  encryptDeliverySecret,
  hashDeliveryOAuthState,
} from "../core/crypto.service";
import { DeliveryConfigurationError, DeliveryError } from "../core/delivery.interface";
import { metaAuthorizeUrl, type MetaApiConfig, getMetaApiConfig } from "../core/meta-client";
import {
  createDeliveryRepository,
  deliveryRepository,
  type DeliveryDatabase,
  type DeliveryRepository,
} from "../repositories/delivery.repository";
import { INSTAGRAM_OAUTH_SCOPES, InstagramClient, type MetaTokenResponse } from "./client";

/**
 * Instagram Business OAuth lifecycle (PR010 §4) — server-side ONLY.
 *
 * Implements the official Facebook Login flow for Instagram Business
 * Messaging:
 *   connectInstagram() → Meta dialog (random, hashed, single-use state)
 *   exchangeCode()     → code → short-lived token → long-lived token →
 *                        Instagram Business account discovery → encrypted
 *                        upsert + AuditLog
 *   refreshToken()     → long-lived token rotation before expiry
 *
 * Tokens are stored AES-256-GCM (`META_ENCRYPTION_KEY`) and never leave
 * the server.
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;
/** Fallback when Meta omits `expires_in` on a long-lived exchange (≈60d). */
const LONG_LIVED_FALLBACK_SECONDS = 60 * 24 * 60 * 60;

export class InstagramOAuthError extends DeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "InstagramOAuthError";
  }
}

/** The OAuth redirect must match the Meta App configuration exactly. */
export function getInstagramRedirectUri(): string {
  const explicit = process.env.META_INSTAGRAM_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXTAUTH_URL?.trim();
  if (!appUrl) {
    throw new InstagramOAuthError(
      "NEXTAUTH_URL (or META_INSTAGRAM_REDIRECT_URI) is required to construct the Instagram OAuth callback URL.",
    );
  }
  return `${appUrl.replace(/\/$/, "")}/api/instagram/callback`;
}

function resolveExpiry(data: MetaTokenResponse, now: Date, fallbackSeconds?: number): Date | null {
  const seconds = data.expires_in;
  if (typeof seconds === "number" && Number.isFinite(seconds)) {
    if (seconds <= 0) return null; // non-expiring (e.g. system user tokens)
    return new Date(now.getTime() + seconds * 1000);
  }
  if (fallbackSeconds) return new Date(now.getTime() + fallbackSeconds * 1000);
  return null;
}

export interface InstagramOAuthDependencies {
  db?: DeliveryDatabase;
  repository?: DeliveryRepository;
  config?: MetaApiConfig;
  now?: () => Date;
  randomState?: () => string;
  client?: InstagramClient;
  redirectUri?: string;
  encrypt?: (plaintext: string) => string;
}

export function createInstagramOAuthService(deps: InstagramOAuthDependencies = {}) {
  const db = deps.db ?? prisma;
  const repository = deps.repository ?? createDeliveryRepository(db);
  const config = deps.config ?? null; // resolved lazily — env may be absent in tests/build
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));
  const encrypt = deps.encrypt ?? ((plaintext: string) => encryptDeliverySecret(plaintext));
  const client = deps.client ?? null;

  function resolveClient(): InstagramClient {
    return client ?? new InstagramClient(config ?? getMetaApiConfig());
  }

  function resolveConfig(): MetaApiConfig {
    if (config) return config;
    try {
      return getMetaApiConfig();
    } catch (error) {
      if (error instanceof DeliveryConfigurationError) throw new InstagramOAuthError(error.message);
      throw error;
    }
  }

  return {
    /**
     * Start the official OAuth flow. The browser receives ONLY the Meta
     * dialog URL; the state is random, stored as a SHA-256 digest,
     * single-use and expires in ten minutes.
     */
    async connectInstagram(organizationId: string): Promise<{ authorizationUrl: string }> {
      const scope = tenantWhere(organizationId);
      const current = now();
      await repository.purgeExpiredOAuthStates(scope.organizationId, current);
      const state = randomState();
      await repository.createOAuthState({
        organizationId: scope.organizationId,
        channel: "INSTAGRAM",
        stateHash: hashDeliveryOAuthState(state),
        expiresAt: new Date(current.getTime() + OAUTH_STATE_TTL_MS),
      });

      const metaConfig = resolveConfig();
      const url = new URL(metaAuthorizeUrl());
      url.searchParams.set("client_id", metaConfig.appId);
      url.searchParams.set("redirect_uri", deps.redirectUri ?? getInstagramRedirectUri());
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", INSTAGRAM_OAUTH_SCOPES.join(","));
      return { authorizationUrl: url.toString() };
    },

    /**
     * Complete the flow: consume the one-time state, exchange the code,
     * upgrade to a long-lived token, discover Instagram Business accounts
     * and persist every credential encrypted. Never throws provider details
     * to the caller-visible layer.
     */
    async exchangeCode(input: { code: string; state: string }): Promise<DeliveryAccount[]> {
      const current = now();
      const stateHash = hashDeliveryOAuthState(input.state);
      const stored = await repository.findOAuthStateByHash(stateHash);
      if (!stored || stored.channel !== "INSTAGRAM" || stored.expiresAt <= current) {
        if (stored) await db.deliveryOAuthState.deleteMany({ where: { id: stored.id } });
        throw new InstagramOAuthError(
          "Instagram authorization state is invalid or expired. Start the connection again.",
        );
      }
      const consumed = await repository.consumeOAuthState(stored.id, current);
      if (!consumed) {
        throw new InstagramOAuthError("Instagram authorization state has already been used.");
      }

      const instagram = resolveClient();
      const redirectUri = deps.redirectUri ?? getInstagramRedirectUri();
      const shortLived = await instagram.exchangeCode(input.code, redirectUri);
      if (!shortLived.access_token) {
        throw new InstagramOAuthError("Meta did not return an access token for Instagram.");
      }
      const longLived = await instagram.exchangeForLongLivedToken(shortLived.access_token);
      const accessToken = longLived.access_token ?? shortLived.access_token;
      const expiresAt = resolveExpiry(longLived, current, LONG_LIVED_FALLBACK_SECONDS);

      const accounts = await instagram.listBusinessAccounts(accessToken);
      if (accounts.length === 0) {
        throw new InstagramOAuthError(
          "No Instagram Business account is linked to the authorized Facebook Pages.",
        );
      }

      const encryptedAccessToken = encrypt(accessToken);
      const results: DeliveryAccount[] = [];
      for (const account of accounts) {
        const saved = await repository.upsertConnectedAccount(stored.organizationId, {
          channel: "INSTAGRAM",
          accountId: account.id,
          accountName: account.username ? `@${account.username}` : (account.name ?? null),
          encryptedAccessToken,
          encryptedRefreshToken: null,
          expiresAt,
        });
        results.push(saved);
      }

      await repository.writeAuditLog({
        organizationId: stored.organizationId,
        action: "INSTAGRAM_CONNECTED",
        entityType: "DeliveryAccount",
        metadata: {
          accounts: results.map((account) => account.accountId),
        } as Prisma.InputJsonValue,
      });
      return results;
    },

    /** Rotate a long-lived token before it expires (official fb_exchange_token). */
    async refreshToken(organizationId: string, accountPk: string): Promise<Date | null> {
      const account = await repository.findAccountById(organizationId, accountPk);
      if (!account)
        throw new InstagramOAuthError("Instagram account was not found in this workspace.");
      if (!account.encryptedAccessToken) {
        throw new InstagramOAuthError("Instagram account has no stored credential to refresh.");
      }
      const currentToken = decryptDeliverySecret(account.encryptedAccessToken);
      try {
        const refreshed = await resolveClient().refreshLongLivedToken(currentToken);
        if (!refreshed.access_token) {
          throw new InstagramOAuthError("Meta did not return a renewed Instagram token.");
        }
        const expiresAt = resolveExpiry(refreshed, now(), LONG_LIVED_FALLBACK_SECONDS);
        await repository.saveTokens(organizationId, account.id, {
          encryptedAccessToken: encrypt(refreshed.access_token),
          encryptedRefreshToken: null,
          expiresAt,
        });
        return expiresAt;
      } catch (error) {
        await repository.markAccountStatus(organizationId, account.id, "EXPIRED");
        throw error instanceof InstagramOAuthError
          ? error
          : new InstagramOAuthError("Instagram token refresh failed — reconnect the account.");
      }
    },

    /** Return a valid plaintext token, transparently refreshing near expiry. */
    async getValidAccessToken(organizationId: string, account: DeliveryAccount): Promise<string> {
      if (!account.encryptedAccessToken) {
        throw new InstagramOAuthError("Instagram account is disconnected.");
      }
      if (
        account.expiresAt &&
        account.expiresAt.getTime() <= now().getTime() + TOKEN_REFRESH_SKEW_MS
      ) {
        await this.refreshToken(organizationId, account.id);
        const refreshed = await repository.findAccountById(organizationId, account.id);
        if (!refreshed?.encryptedAccessToken) {
          throw new InstagramOAuthError("Instagram token refresh did not produce a credential.");
        }
        return decryptDeliverySecret(refreshed.encryptedAccessToken);
      }
      return decryptDeliverySecret(account.encryptedAccessToken);
    },

    /**
     * Local revocation: Meta app deauthorization is configured app-side;
     * here we immediately destroy ciphertext so this app can never call
     * the API with the account again.
     */
    async disconnectInstagram(organizationId: string, accountPk: string): Promise<boolean> {
      const disconnected = await repository.disconnectAccount(organizationId, accountPk);
      if (disconnected) {
        await repository.writeAuditLog({
          organizationId,
          action: "INSTAGRAM_DISCONNECTED",
          entityType: "DeliveryAccount",
          entityId: accountPk,
        });
      }
      return disconnected;
    },
  };
}

export const instagramOAuthService = createInstagramOAuthService({
  repository: deliveryRepository,
});

/** Public server-side methods required by the delivery contract (PR010 §4). */
export const connectInstagram = (organizationId: string) =>
  instagramOAuthService.connectInstagram(organizationId);
export const exchangeCode = (input: { code: string; state: string }) =>
  instagramOAuthService.exchangeCode(input);
export const refreshToken = (organizationId: string, accountPk: string) =>
  instagramOAuthService.refreshToken(organizationId, accountPk);
export const disconnectInstagram = (organizationId: string, accountPk: string) =>
  instagramOAuthService.disconnectInstagram(organizationId, accountPk);
