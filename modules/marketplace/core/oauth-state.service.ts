import "server-only";

import { randomBytes } from "node:crypto";
import type { ConnectorProvider } from "@prisma/client";
import { tenantWhere } from "@/lib/tenant";
import type { MarketplaceDatabase } from "./connector.repository";
import { marketplaceRepository as _defaultRepository } from "./connector.repository";
import { hashConnectorOAuthState } from "./crypto.service";

/**
 * Connector OAuth state service (PR012) — short-lived, one-time, server-side
 * CSRF states for the Shopee and Mercado Livre OAuth redirects.
 *
 * Same contract as the PR009 TikTok flow: the state is random (256 bits),
 * hashed (SHA-256) at rest, expires in ten minutes and is consumed exactly
 * once before the authorization code is exchanged.
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class ConnectorOAuthStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorOAuthStateError";
  }
}

export interface ConnectorOAuthStateDependencies {
  db?: MarketplaceDatabase;
  now?: () => Date;
  randomState?: () => string;
}

export function createConnectorOAuthStateService(
  db: MarketplaceDatabase,
  deps: Omit<ConnectorOAuthStateDependencies, "db"> = {},
) {
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));

  return {
    /** Issue a new opaque state for one provider inside one tenant. */
    async issue(organizationId: string, provider: ConnectorProvider): Promise<string> {
      const scope = tenantWhere(organizationId);
      const state = randomState();
      const current = now();
      // Opportunistic cleanup of expired states for this tenant/provider.
      await db.connectorOAuthState.deleteMany({
        where: {
          organizationId: scope.organizationId,
          provider,
          expiresAt: { lte: current },
        },
      });
      await db.connectorOAuthState.create({
        data: {
          organizationId: scope.organizationId,
          provider,
          stateHash: hashConnectorOAuthState(state),
          expiresAt: new Date(current.getTime() + OAUTH_STATE_TTL_MS),
        },
      });
      return state;
    },

    /**
     * Consume a state presented by an OAuth callback. The state — and only
     * it — determines the tenant; it is single-use and time-boxed.
     *
     * @throws {ConnectorOAuthStateError} invalid, expired or replayed state.
     */
    async consume(
      state: string,
      provider: ConnectorProvider,
    ): Promise<{ organizationId: string }> {
      const current = now();
      const stateHash = hashConnectorOAuthState(state);
      const stored = await db.connectorOAuthState.findUnique({ where: { stateHash } });
      if (!stored || stored.provider !== provider || stored.expiresAt <= current) {
        if (stored) await db.connectorOAuthState.deleteMany({ where: { id: stored.id } });
        throw new ConnectorOAuthStateError(
          "O estado de autorização é inválido ou expirou. Inicie a conexão novamente.",
        );
      }
      const consumed = await db.connectorOAuthState.deleteMany({
        where: { id: stored.id, expiresAt: { gt: current } },
      });
      if (consumed.count !== 1) {
        throw new ConnectorOAuthStateError("O estado de autorização já foi utilizado.");
      }
      return { organizationId: stored.organizationId };
    },
  };
}

import { prisma } from "@/lib/prisma";

/** Default singleton bound to the app's Prisma client. */
export const connectorOAuthStateService = createConnectorOAuthStateService(prisma);
