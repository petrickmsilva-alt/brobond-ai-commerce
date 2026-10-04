import "server-only";

import type { Connector, ConnectorProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { connectorRepository as connectorStatusRepository } from "@/modules/connectors/core/connector.repository";
import {
  TIKTOK_LOGIN_STATE_COOKIE,
  TIKTOK_LOGIN_STATE_TTL_SECONDS,
} from "@/modules/connectors/tiktok/auth/login-kit.config";
import { createTikTokAuthorization } from "@/modules/connectors/tiktok/auth/login-kit.repository";
import { connectInstagram } from "@/modules/delivery/instagram/auth.service";
import { marketplaceRepository, type MarketplaceRepository } from "./connector.repository";
import { connectorOAuthStateService } from "./oauth-state.service";
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
  maskConnectorSecretPreview,
} from "./crypto.service";
import {
  ConnectorConfigError,
  ConnectorReauthRequiredError,
  ConnectorTokenUndecryptableError,
  MarketplaceError,
} from "./errors";
import {
  CONNECTOR_PROVIDERS,
  CONNECTOR_PROVIDER_AUTH,
  CONNECTOR_PROVIDER_DESCRIPTIONS,
  CONNECTOR_PROVIDER_LABELS,
} from "./providers";
import { toConnectorCardDTO, type ConnectorCardDTO } from "./connector.dto";
import { mirrorInstagramConnection } from "../instagram/instagram-bridge.service";
import { mirrorTikTokConnection } from "../tiktok/tiktok-bridge.service";
import {
  buildShopeeAuthorizationUrl,
  exchangeShopeeCode,
  fetchShopeeShopInfo,
} from "../shopee/shopee.service";
import {
  buildMercadoLivreAuthorizationUrl,
  exchangeMercadoLivreCode,
  fetchMercadoLivreIdentity,
} from "../mercadolivre/mercadolivre.service";
import { validateMercadoPagoAccessToken } from "../mercadopago/mercadopago.service";
import {
  getMercadoPagoEnvironmentCredentials,
  hasPersistedMercadoPagoCredentials,
  type MercadoPagoEnvironment,
} from "../mercadopago/credentials";

/**
 * Marketplace connector service (PR012) — the single orchestration point
 * for connecting, mirroring and disconnecting the five real providers.
 *
 * SECURITY CONTRACT: every credential is encrypted (AES-256-GCM) BEFORE the
 * upsert; this service never returns plaintext to callers — the only secret
 * derivative that leaves the server is the masked public-key preview.
 */

const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000;

/**
 * An opaque CSRF state the action layer must plant as an HttpOnly cookie
 * before sending the browser to the provider.
 *
 * It is returned as DATA instead of being written here on purpose: this
 * module is unit-tested outside a Next.js request scope, so it must never
 * import `next/headers`. `lib/oauth-state-cookie.ts` performs the write.
 */
export interface ConnectorOAuthStateCookie {
  readonly name: string;
  readonly value: string;
  readonly maxAge: number;
}

/** Result of `startOAuth`: where to send the browser, and what to remember. */
export interface ConnectorAuthorizationStart {
  readonly authorizationUrl: string;
  readonly stateCookie?: ConnectorOAuthStateCookie;
}

/**
 * Decrypt a stored credential, translating a crypto failure into the action
 * the operator must take.
 *
 * Rotating `CONNECTOR_ENCRYPTION_KEY` (or deploying with a different one
 * than the instance that stored the tokens) makes every AES-256-GCM
 * ciphertext fail its auth tag. The row still says CONNECTED, so the UI kept
 * offering "Sincronizar" and the operator only saw an opaque listing error.
 * Reconnecting re-encrypts with the current key, which is exactly what this
 * message asks for.
 *
 * The dedicated `ConnectorTokenUndecryptableError` subtype lets
 * `getValidAccessToken()` park the channel in REAUTH_REQUIRED (not the
 * generic EXPIRED/ERROR) so the panel renders the clean connect button
 * (PR016.2).
 */
function decryptCredential(
  ciphertext: string,
  provider: ConnectorProvider,
  label: "token de acesso" | "refresh token",
): string {
  try {
    return decryptConnectorSecret(ciphertext);
  } catch (error) {
    throw new ConnectorTokenUndecryptableError(
      provider,
      `Não foi possível descriptografar o ${label} salvo deste conector — a chave CONNECTOR_ENCRYPTION_KEY mudou desde a conexão. Reconecte a conta para gerar credenciais novas.`,
      { cause: error },
    );
  }
}

/**
 * Graceful degradation when a stored credential can no longer be opened
 * (PR016.2 "crypto catch").
 *
 * The channel is parked in the dedicated `REAUTH_REQUIRED` status on
 * PostgreSQL — the panel then unlocks the card and renders the clean
 * connect button. This persistence is BEST-EFFORT: a database hiccup here
 * must never turn a decrypt failure into a server crash, so it is guarded
 * and only logged. The thrown domain error remains the actionable signal.
 */
async function parkConnectorForUndecryptableCredential(
  repository: MarketplaceRepository,
  organizationId: string,
  provider: ConnectorProvider,
  error: ConnectorTokenUndecryptableError,
): Promise<void> {
  try {
    await repository.setStatus(organizationId, provider, "REAUTH_REQUIRED", error.message);
  } catch (persistError) {
    console.error(
      "[connector.crypto] não foi possível gravar REAUTH_REQUIRED no banco — a falha de descriptografia segue reportada pelo erro de domínio",
      {
        provider: String(provider),
        persistError: persistError instanceof Error ? persistError.message : String(persistError),
      },
    );
  }
  console.error(
    "[connector.crypto] credencial salva não pôde ser aberta — canal movido para REAUTH_REQUIRED",
    {
      provider: String(provider),
      message: error.message,
      cause: error.cause instanceof Error ? error.cause.name : undefined,
    },
  );
}

export interface MarketplaceServiceDependencies {
  repository?: MarketplaceRepository;
  statusRepository?: Pick<typeof connectorStatusRepository, "findStatus">;
  now?: () => Date;
  /** Explicit environment injection keeps fallback resolution unit-testable. */
  env?: MercadoPagoEnvironment;
}

/** Masked public-key preview — the ONLY secret derivative the UI receives. */
function publicKeyPreviewOf(row: Connector | null): string | null {
  if (!row?.publicKey) return null;
  try {
    return maskConnectorSecretPreview(decryptConnectorSecret(row.publicKey));
  } catch {
    return null;
  }
}

export function createMarketplaceService(deps: MarketplaceServiceDependencies = {}) {
  const repository = deps.repository ?? marketplaceRepository;
  const statusRepository = deps.statusRepository ?? connectorStatusRepository;
  const now = deps.now ?? (() => new Date());
  const env = deps.env ?? process.env;

  return {
    /**
     * Card DTOs for the five providers. Before reading, mirrors the PR009 /
     * PR010 credentials (TikTok / Instagram) so the cards always reflect the
     * real connection state — mirroring never throws into the listing.
     */
    async listConnectorCards(organizationId: string): Promise<ConnectorCardDTO[]> {
      await Promise.allSettled([
        mirrorTikTokConnection(organizationId),
        mirrorInstagramConnection(organizationId),
      ]);
      const rows = await repository.list(organizationId);
      const byProvider = new Map(rows.map((row) => [row.provider, row]));

      const mercadoPagoRow = byProvider.get("MERCADOPAGO") ?? null;
      // PR016.2 — a credential that no longer decrypts
      // (CONNECTOR_ENCRYPTION_KEY rotation) is NOT usable even though both
      // ciphertexts are still stored: the channel was parked in
      // REAUTH_REQUIRED by the crypto catch in `getValidAccessToken()`.
      // The card must NOT render the locked "connected" state — it unlocks
      // and offers the clean connect button (reconnecting re-encrypts with
      // the current key). The Render environment pair is deliberately NOT
      // used as a fallback here either: `getValidAccessToken()` prefers the
      // tenant's persisted pair, so the card must advertise the same truth.
      const mercadoPagoRequiresReauth = mercadoPagoRow?.status === "REAUTH_REQUIRED";
      const persistedMercadoPago =
        !mercadoPagoRequiresReauth && hasPersistedMercadoPagoCredentials(mercadoPagoRow);
      const environmentMercadoPago = mercadoPagoRequiresReauth
        ? null
        : getMercadoPagoEnvironmentCredentials(env);
      const mercadoPagoSource = persistedMercadoPago
        ? ("database" as const)
        : environmentMercadoPago
          ? ("environment" as const)
          : null;

      // An environment-only installation has no unified Connector row from
      // which to read counters. ConnectorStatus is the synchronization source
      // of truth and lets the locked card retain its metrics across reloads.
      const fallbackMetrics =
        mercadoPagoSource === "environment" && !mercadoPagoRow
          ? await statusRepository
              .findStatus(organizationId, "MERCADOPAGO")
              .then((status) =>
                status
                  ? {
                      importedCount: status.importedCount,
                      duplicatedCount: status.duplicateCount,
                      failedCount: status.failedCount,
                      syncCount: status.syncCount,
                      lastSyncAt: status.lastSyncAt?.toISOString() ?? null,
                      lastError: status.lastError,
                    }
                  : undefined,
              )
              .catch(() => undefined)
          : undefined;

      return CONNECTOR_PROVIDERS.map((provider) => {
        const row = byProvider.get(provider) ?? null;
        const isMercadoPago = provider === "MERCADOPAGO";
        const locked = isMercadoPago && mercadoPagoSource !== null;
        const publicKeyPreview =
          publicKeyPreviewOf(row) ??
          (isMercadoPago && mercadoPagoSource === "environment" && environmentMercadoPago
            ? maskConnectorSecretPreview(environmentMercadoPago.publicKey)
            : null);

        return toConnectorCardDTO(
          {
            provider,
            name: CONNECTOR_PROVIDER_LABELS[provider],
            description: CONNECTOR_PROVIDER_DESCRIPTIONS[provider],
            authType: CONNECTOR_PROVIDER_AUTH[provider],
          },
          row,
          {
            publicKeyPreview,
            status: locked ? "CONNECTED" : undefined,
            locked,
            credentialSource: isMercadoPago ? mercadoPagoSource : null,
            metrics: isMercadoPago ? fallbackMetrics : undefined,
          },
        );
      });
    },

    /**
     * Start an OAuth2 connection. Returns ONLY the provider authorization
     * URL (plus, when the provider needs one, the opaque CSRF state the
     * action layer must plant as an HttpOnly cookie) — the browser is then
     * sent there by the caller.
     *
     * TikTok authorizes through **Login Kit v2 on `tiktok.com`**: the
     * consumer/creator consent gateway registered in our Sandbox profile
     * (`client_key`, `scope=user.info.stats`, `response_type=code`, the
     * localhost `redirect_uri` and `state`). The commercial TikTok Shop
     * seller gateway is deliberately NOT used here — it answers "this
     * service does not exist" for this app.
     *
     * Instagram reuses the PR010 official flow; Shopee binds the tenant via
     * the authenticated session on the callback; Mercado Livre consumes a
     * PR012 single-use state.
     */
    async startOAuth(
      organizationId: string,
      provider: ConnectorProvider,
    ): Promise<ConnectorAuthorizationStart> {
      switch (provider) {
        case "TIKTOK": {
          // Hashed, single-use `ConnectorOAuthState` row resolves the tenant
          // on the callback; the cookie below is the double-submit half.
          const { url, state } = await createTikTokAuthorization(organizationId);
          return {
            authorizationUrl: url,
            stateCookie: {
              name: TIKTOK_LOGIN_STATE_COOKIE,
              value: state,
              maxAge: TIKTOK_LOGIN_STATE_TTL_SECONDS,
            },
          };
        }
        case "INSTAGRAM":
          return connectInstagram(organizationId);
        case "SHOPEE":
          return { authorizationUrl: buildShopeeAuthorizationUrl() };
        case "MERCADOLIVRE": {
          const state = await connectorOAuthStateService.issue(organizationId, provider);
          return { authorizationUrl: buildMercadoLivreAuthorizationUrl(state) };
        }
        case "MERCADOPAGO":
          throw new MarketplaceError(
            "O Mercado Pago é conectado com Access Token e Public Key de produção, não por OAuth.",
            provider,
          );
        default:
          throw new MarketplaceError(`Provedor não suportado: ${String(provider)}.`);
      }
    },

    /**
     * Shopee callback: exchange the code for the shop token pair, resolve
     * the shop name and persist everything encrypted. The tenant comes from
     * the authenticated ADMIN session (the Shopee redirect carries no state).
     */
    async handleShopeeCallback(
      organizationId: string,
      input: { code: string; shop_id: string },
    ): Promise<Connector> {
      const tokens = await exchangeShopeeCode(input.code, input.shop_id);
      const shop = await fetchShopeeShopInfo(tokens.accessToken, input.shop_id).catch(() => ({
        shopName: null,
      }));
      const connector = await repository.upsertConnection(organizationId, "SHOPEE", {
        status: "CONNECTED",
        accessToken: encryptConnectorSecret(tokens.accessToken),
        refreshToken: encryptConnectorSecret(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        shopId: input.shop_id,
        shopName: shop.shopName,
      });
      await prisma.auditLog.create({
        data: {
          organizationId,
          action: "SHOPEE_CONNECTED",
          entityType: "Connector",
          entityId: connector.id,
          metadata: { shopId: input.shop_id } as Prisma.InputJsonValue,
        },
      });
      return connector;
    },

    /**
     * Mercado Livre callback: consume the single-use state (the state — and
     * only it — determines the tenant), exchange the code and persist the
     * encrypted credential pair plus the seller identity.
     *
     * PR016.2 — the exchange replays the STATIC unified redirect URI
     * (`MERCADOLIVRE_REDIRECT_URI` / `MERCADOPAGO_REDIRECT_URI`), the same
     * value `buildMercadoLivreAuthorizationUrl()` sent on `/authorization`.
     * No request-derived computation: the inbound request never feeds the
     * `redirect_uri`, so the two legs cannot diverge.
     */
    async handleMercadoLivreCallback(input: { code: string; state: string }): Promise<Connector> {
      const { organizationId } = await connectorOAuthStateService.consume(
        input.state,
        "MERCADOLIVRE",
      );
      const tokens = await exchangeMercadoLivreCode(input.code);
      const identity = await fetchMercadoLivreIdentity(tokens.accessToken);
      const connector = await repository.upsertConnection(organizationId, "MERCADOLIVRE", {
        status: "CONNECTED",
        accessToken: encryptConnectorSecret(tokens.accessToken),
        refreshToken: encryptConnectorSecret(tokens.refreshToken),
        expiresAt: tokens.expiresAt,
        shopId: identity.userId,
        shopName: identity.nickname,
        metadata: { siteId: identity.siteId } as Prisma.InputJsonValue,
      });
      await prisma.auditLog.create({
        data: {
          organizationId,
          action: "MERCADOLIVRE_CONNECTED",
          entityType: "Connector",
          entityId: connector.id,
          metadata: { userId: identity.userId } as Prisma.InputJsonValue,
        },
      });
      return connector;
    },

    /**
     * Mercado Pago connect: validate the production Access Token against
     * `/users/me` BEFORE persisting (a credential is never stored without
     * passing the official validation), then save both keys encrypted.
     */
    async connectMercadoPago(
      organizationId: string,
      input: { accessToken: string; publicKey: string },
    ): Promise<Connector> {
      const identity = await validateMercadoPagoAccessToken(input.accessToken);
      const connector = await repository.upsertConnection(organizationId, "MERCADOPAGO", {
        status: "CONNECTED",
        accessToken: encryptConnectorSecret(input.accessToken),
        publicKey: encryptConnectorSecret(input.publicKey),
        refreshToken: null,
        expiresAt: null,
        shopId: identity.userId,
        shopName: identity.nickname,
        metadata: { siteId: identity.siteId, email: identity.email } as Prisma.InputJsonValue,
      });
      await prisma.auditLog.create({
        data: {
          organizationId,
          action: "MERCADOPAGO_CONNECTED",
          entityType: "Connector",
          entityId: connector.id,
          metadata: { userId: identity.userId } as Prisma.InputJsonValue,
        },
      });
      return connector;
    },

    /**
     * Return a VALID plaintext access token for a provider, transparently
     * refreshing it when it is expired or about to expire (Shopee and
     * Mercado Livre rotate refresh tokens; Mercado Pago tokens do not
     * expire). TikTok and Instagram are served by their PR009/PR010
     * bridges and never reach this method.
     */
    async getValidAccessToken(
      organizationId: string,
      provider: ConnectorProvider,
    ): Promise<{ accessToken: string; shopId: string | null }> {
      const connector = await repository.findByProvider(organizationId, provider);
      const environmentCredentials =
        provider === "MERCADOPAGO" ? getMercadoPagoEnvironmentCredentials(env) : null;
      if (
        provider === "MERCADOPAGO" &&
        !hasPersistedMercadoPagoCredentials(connector) &&
        environmentCredentials
      ) {
        return { accessToken: environmentCredentials.accessToken, shopId: null };
      }
      if (!connector?.accessToken) {
        // `requiresReauth` turns this into the "Conectar Conta …" call to
        // action instead of a dead-end error (PR016.1).
        throw new ConnectorReauthRequiredError(
          provider,
          `O conector "${String(provider)}" não possui credencial ativa. Conecte a conta primeiro.`,
        );
      }

      // PR016.2 — the whole credential READ + AES-256-GCM DECRYPT path is
      // guarded. A ciphertext saved before a `CONNECTOR_ENCRYPTION_KEY`
      // rotation can never open again; that state is captured gracefully:
      // the channel is parked in REAUTH_REQUIRED on PostgreSQL (best-effort,
      // never a crash) and the rethrown domain error carries the action the
      // operator must take. The panel renders the clean connect button.
      try {
        const expiring =
          connector.expiresAt &&
          connector.expiresAt.getTime() <= now().getTime() + TOKEN_REFRESH_SKEW_MS;
        if (!expiring) {
          return {
            accessToken: decryptCredential(connector.accessToken, provider, "token de acesso"),
            shopId: connector.shopId,
          };
        }
        if (!connector.refreshToken) {
          await repository.setStatus(organizationId, provider, "EXPIRED");
          throw new ConnectorReauthRequiredError(
            provider,
            `A credencial do conector "${String(provider)}" expirou. Reconecte a conta.`,
          );
        }

        const refreshToken = decryptCredential(connector.refreshToken, provider, "refresh token");
        try {
          if (provider === "SHOPEE") {
            if (!connector.shopId) throw new ConnectorConfigError("shopId", provider);
            const { refreshShopeeToken } = await import("../shopee/shopee.service");
            const tokens = await refreshShopeeToken(refreshToken, connector.shopId);
            await repository.saveTokens(organizationId, connector.id, {
              accessToken: encryptConnectorSecret(tokens.accessToken),
              refreshToken: encryptConnectorSecret(tokens.refreshToken),
              expiresAt: tokens.expiresAt,
            });
            return { accessToken: tokens.accessToken, shopId: connector.shopId };
          }
          if (provider === "MERCADOLIVRE") {
            const { refreshMercadoLivreToken } =
              await import("../mercadolivre/mercadolivre.service");
            const tokens = await refreshMercadoLivreToken(refreshToken);
            await repository.saveTokens(organizationId, connector.id, {
              accessToken: encryptConnectorSecret(tokens.accessToken),
              refreshToken: encryptConnectorSecret(tokens.refreshToken),
              expiresAt: tokens.expiresAt,
            });
            return { accessToken: tokens.accessToken, shopId: connector.shopId };
          }
          await repository.setStatus(organizationId, provider, "EXPIRED");
          throw new MarketplaceError(
            `O conector "${String(provider)}" não suporta renovação automática de token.`,
            provider,
          );
        } catch (error) {
          await repository.setStatus(
            organizationId,
            provider,
            "EXPIRED",
            "A renovação do token falhou — reconecte a conta.",
          );
          // A failed refresh is terminal for this credential: the provider
          // will keep rejecting it until the account is authorized again, so
          // the panel must offer reconnection rather than another retry. Only
          // an error that already carries operator-facing copy survives as-is;
          // a raw provider payload ("invalid_grant") is replaced.
          if (error instanceof ConnectorReauthRequiredError) throw error;
          throw new ConnectorReauthRequiredError(
            provider,
            `A renovação automática do token do conector "${String(provider)}" falhou. Reconecte a conta para restabelecer o acesso.`,
            { cause: error },
          );
        }
      } catch (error) {
        // The crypto catch: an undecryptable token (old
        // CONNECTOR_ENCRYPTION_KEY) is a STATE, not an exception to crash on.
        // Park the channel in REAUTH_REQUIRED and keep the domain error as
        // the single, actionable signal.
        if (error instanceof ConnectorTokenUndecryptableError) {
          await parkConnectorForUndecryptableCredential(
            repository,
            organizationId,
            provider,
            error,
          );
        }
        throw error;
      }
    },

    /**
     * Revoke a connection: wipes every ciphertext locally (this app can
     * never call the provider again) and records the audit trail. Provider
     * -side deauthorization remains available in each seller dashboard.
     */
    async disconnect(organizationId: string, provider: ConnectorProvider): Promise<void> {
      await repository.clearCredentials(organizationId, provider);
      await prisma.auditLog.create({
        data: {
          organizationId,
          action: `${String(provider)}_DISCONNECTED`,
          entityType: "Connector",
        },
      });
    },
  };
}

export const marketplaceService = createMarketplaceService();
