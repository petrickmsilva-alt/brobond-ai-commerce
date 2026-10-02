import "server-only";

import { randomBytes } from "node:crypto";
import type { ConnectorProvider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import type { MarketplaceDatabase } from "./connector.repository";
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
  hashConnectorOAuthState,
} from "./crypto.service";

/**
 * Connector OAuth state service (PR012) — short-lived, one-time, server-side
 * CSRF states for the Shopee and Mercado Livre OAuth redirects.
 *
 * Same contract as the PR009 TikTok flow: the state is random (256 bits),
 * hashed (SHA-256) at rest, expires in ten minutes and is consumed exactly
 * once before the authorization code is exchanged.
 *
 * PKCE (PR016.2) — unified DevCenter applications (Mercado Livre + Mercado
 * Pago) ship with the PKCE flow ENABLED, and with it Meli makes
 * `code_verifier` MANDATORY on the token exchange; without it the exchange
 * dies with `invalid_request: "code_verifier is a required parameter"` and
 * the connector never connects. The verifier is therefore issued together
 * with the state, persisted as an AES-256-GCM ciphertext (never plaintext at
 * rest — the verifier is what the `code_challenge` protects) and travels
 * back through `consume()` so the exchange can prove possession of it.
 * Shopee and legacy pre-migration states carry no verifier and keep the
 * exact behaviour they always had.
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class ConnectorOAuthStateError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "ConnectorOAuthStateError";
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface ConnectorOAuthStateDependencies {
  now?: () => Date;
  randomState?: () => string;
}

/** Extra material bound to a state at issuance time. */
export interface ConnectorOAuthStateIssueOptions {
  /**
   * RFC 7636 code_verifier (43–128 chars) to persist — encrypted — alongside
   * the state. Required for Mercado Livre applications with PKCE enabled.
   */
  codeVerifier?: string;
}

export interface ConnectorOAuthStateIssued {
  state: string;
  codeVerifier?: string;
}

export interface ConnectorOAuthStateConsumed {
  organizationId: string;
  codeVerifier?: string;
}

export function createConnectorOAuthStateService(
  db: MarketplaceDatabase,
  deps: ConnectorOAuthStateDependencies = {},
) {
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));

  return {
    /**
     * Issue a new opaque state for one provider inside one tenant. When a
     * PKCE `codeVerifier` is supplied it is persisted next to the state as
     * an AES-256-GCM ciphertext and returned to the caller, which needs it
     * to derive the `code_challenge` sent to the provider.
     */
    async issue(
      organizationId: string,
      provider: ConnectorProvider,
      options: ConnectorOAuthStateIssueOptions = {},
    ): Promise<ConnectorOAuthStateIssued> {
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
      const codeVerifier = options.codeVerifier?.trim();
      await db.connectorOAuthState.create({
        data: {
          organizationId: scope.organizationId,
          provider,
          stateHash: hashConnectorOAuthState(state),
          ...(codeVerifier ? { codeVerifier: encryptConnectorSecret(codeVerifier) } : {}),
          expiresAt: new Date(current.getTime() + OAUTH_STATE_TTL_MS),
        },
      });
      return codeVerifier ? { state, codeVerifier } : { state };
    },

    /**
     * Consume a state presented by an OAuth callback. The state — and only
     * it — determines the tenant; it is single-use and time-boxed. The PKCE
     * code_verifier issued with the state is decrypted and returned so the
     * token exchange can replay it (Meli requires this when the application
     * has the PKCE flow enabled).
     *
     * @throws {ConnectorOAuthStateError} invalid, expired, replayed state or
     *   a verifier that can no longer be decrypted (the fix is identical:
     *   start a fresh connection).
     */
    async consume(
      state: string,
      provider: ConnectorProvider,
    ): Promise<ConnectorOAuthStateConsumed> {
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
      let codeVerifier: string | undefined;
      if (stored.codeVerifier) {
        try {
          codeVerifier = decryptConnectorSecret(stored.codeVerifier);
        } catch (error) {
          // A verifier that cannot be decrypted (CONNECTOR_ENCRYPTION_KEY
          // rotated mid-flow) can never satisfy the token exchange — the
          // only way forward is a fresh authorization, which is what the
          // `reason=state` guidance already tells the operator to do.
          throw new ConnectorOAuthStateError(
            "Não foi possível recuperar o verificador PKCE da autorização. Inicie a conexão novamente.",
            { cause: error },
          );
        }
      }
      return { organizationId: stored.organizationId, ...(codeVerifier ? { codeVerifier } : {}) };
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const connectorOAuthStateService = createConnectorOAuthStateService(prisma);
