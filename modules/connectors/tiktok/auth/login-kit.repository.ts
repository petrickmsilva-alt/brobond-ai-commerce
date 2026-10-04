import "server-only";

import type { Connector, Prisma } from "@prisma/client";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { encryptConnectorSecret } from "@/modules/marketplace/core/crypto.service";
import { connectorOAuthStateService } from "@/modules/marketplace/core/oauth-state.service";
import {
  buildTikTokAuthorizationUrl,
  exchangeTikTokCode,
  TIKTOK_LOGIN_PROVIDER,
  type TikTokLoginAuthorizationUrl,
  type TikTokLoginDependencies,
  type TikTokLoginTokenSet,
} from "./login-kit.service";

/**
 * TikTok Login Kit v2 persistence layer — the ONLY place that writes the
 * Login Kit credential to Postgres (unified `Connector` row, provider
 * `TIKTOK`, one row per tenant). Kept apart from the pure OAuth utilities
 * so the URL builder and the code exchange stay database-free and unit
 * testable.
 */

/**
 * Create a one-time CSRF state (persisted as a SHA-256 digest in
 * `ConnectorOAuthState`, single-use, 10 min TTL) and the matching TikTok
 * consent URL for one tenant.
 */
export async function createTikTokAuthorization(
  organizationId: string,
  deps: TikTokLoginDependencies = {},
): Promise<TikTokLoginAuthorizationUrl> {
  const state = await connectorOAuthStateService.issue(organizationId, TIKTOK_LOGIN_PROVIDER);
  return { url: buildTikTokAuthorizationUrl(state, deps), state };
}

/**
 * Securely upsert the TikTok credential under the tenant's channel manager
 * profile. Tokens are encrypted with `CONNECTOR_ENCRYPTION_KEY`; `open_id` is
 * stored as the provider identity (`shopId`) of the `TIKTOK` connector row.
 */
export async function persistTikTokLoginCredentials(
  organizationId: string,
  tokens: TikTokLoginTokenSet,
): Promise<Connector> {
  const metadata: Prisma.InputJsonValue = {
    integration: "login_kit_v2",
    environment: process.env.TIKTOK_SANDBOX === "false" ? "production" : "sandbox",
    openId: tokens.openId,
    scope: tokens.scope,
    tokenType: tokens.tokenType,
    refreshTokenExpiresAt: tokens.refreshExpiresAt?.toISOString() ?? null,
    authorizedAt: new Date().toISOString(),
  };

  return marketplaceRepository.upsertConnection(organizationId, TIKTOK_LOGIN_PROVIDER, {
    status: "CONNECTED",
    accessToken: encryptConnectorSecret(tokens.accessToken),
    refreshToken: tokens.refreshToken ? encryptConnectorSecret(tokens.refreshToken) : null,
    expiresAt: tokens.expiresAt,
    shopId: tokens.openId,
    shopName: "TikTok",
    metadata,
  });
}

/** Full server-side completion of the callback: exchange + persistence. */
export async function completeTikTokLogin(
  organizationId: string,
  code: string,
  deps: TikTokLoginDependencies = {},
): Promise<{ connector: Connector; tokens: TikTokLoginTokenSet }> {
  const tokens = await exchangeTikTokCode(code, deps);
  const connector = await persistTikTokLoginCredentials(organizationId, tokens);
  return { connector, tokens };
}
