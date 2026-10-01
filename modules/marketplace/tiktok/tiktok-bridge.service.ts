import "server-only";

import type { Connector } from "@prisma/client";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import { TikTokConnector } from "@/modules/connectors/tiktok/tiktok.connector";
import {
  decryptAccountTokens,
  tiktokTokenRepository,
} from "@/modules/connectors/tiktok/auth/token.service";
import { marketplaceRepository } from "../core/connector.repository";
import { encryptConnectorSecret } from "../core/crypto.service";

/**
 * TikTok Shop bridge (PR012) — official Shop API, server-side ONLY.
 *
 * The OAuth2 flow and the signed API client already ship in PR009; this
 * bridge MIRRORS the connected seller credential into the unified
 * Connector model (re-encrypted under CONNECTOR_ENCRYPTION_KEY) and
 * delegates catalog syncs to the real PR009 adapter.
 */

const PROVIDER = "TIKTOK" as const;

/**
 * Mirror the PR009 TikTok credential into the unified Connector row.
 * Called after a successful OAuth callback and before every sync.
 */
export async function mirrorTikTokConnection(organizationId: string): Promise<Connector | null> {
  const accounts = await tiktokTokenRepository.findConnected(organizationId);
  const account = accounts[0];
  if (!account) return null;
  const tokens = decryptAccountTokens(account);
  return marketplaceRepository.upsertConnection(organizationId, PROVIDER, {
    status: "CONNECTED",
    accessToken: encryptConnectorSecret(tokens.accessToken),
    refreshToken: encryptConnectorSecret(tokens.refreshToken),
    expiresAt: account.expiresAt,
    shopId: account.shopId,
    shopName: account.shopName ?? null,
  });
}

/**
 * Fetch the TikTok Shop catalog through the real PR009 adapter (signed
 * requests, automatic token refresh, rate-limit aware retries).
 */
export async function fetchTikTokContent(
  organizationId: string,
  limit: number,
): Promise<NormalizedContent[]> {
  return new TikTokConnector().fetchContent({ organizationId, limit });
}
