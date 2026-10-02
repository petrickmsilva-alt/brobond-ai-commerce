import "server-only";

import type { Connector, ConnectorProvider, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { connectorRepository as connectorStatusRepository } from "@/modules/connectors/core/connector.repository";
import { connectTikTok } from "@/modules/connectors/tiktok/auth/oauth.service";
import { connectInstagram } from "@/modules/delivery/instagram/auth.service";
import { marketplaceRepository, type MarketplaceRepository } from "./connector.repository";
import { connectorOAuthStateService } from "./oauth-state.service";
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
  maskConnectorSecretPreview,
} from "./crypto.service";
import { ConnectorConfigError, MarketplaceError } from "./errors";
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
      const persistedMercadoPago = hasPersistedMercadoPagoCredentials(mercadoPagoRow);
      const environmentMercadoPago = getMercadoPagoEnvironmentCredentials(env);
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
     * URL — the browser is then redirected by the caller. TikTok and
     * Instagram reuse the PR009/PR010 official flows (hashed, single-use
     * states); Shopee binds the tenant via the authenticated session on the
     * callback; Mercado Livre consumes a PR012 single-use state.
     */
    async startOAuth(
      organizationId: string,
      provider: ConnectorProvider,
    ): Promise<{ authorizationUrl: string }> {
      switch (provider) {
        case "TIKTOK":
          return connectTikTok(organizationId);
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

      if (provider === "MERCADOLIVRE") {
        const configured = Boolean(
          process.env.MERCADOLIVRE_CLIENT_ID?.trim() && process.env.MERCADOLIVRE_CLIENT_SECRET?.trim(),
        );
        if (!configured) {
          await repository.setStatus(
            organizationId,
            provider,
            "DISCONNECTED",
            "Aguardando autenticação da conta de desenvolvedor",
          );
          throw new MarketplaceError(
            "Aguardando autenticação da conta de desenvolvedor",
            provider,
          );
        }
      }

      if (!connector?.accessToken) {
        if (provider === "MERCADOLIVRE") {
          throw new MarketplaceError(
            "Aguardando autenticação da conta de desenvolvedor",
            provider,
          );
        }
        throw new MarketplaceError(
          `O conector "${String(provider)}" não possui credencial ativa. Conecte a conta primeiro.`,
          provider,
        );
      }

      const expiring =
        connector.expiresAt &&
        connector.expiresAt.getTime() <= now().getTime() + TOKEN_REFRESH_SKEW_MS;
      if (!expiring) {
        return {
          accessToken: decryptConnectorSecret(connector.accessToken),
          shopId: connector.shopId,
        };
      }
      if (!connector.refreshToken) {
        const expiredReason =
          provider === "MERCADOLIVRE"
            ? "Aguardando autenticação da conta de desenvolvedor"
            : `A credencial do conector "${String(provider)}" expirou. Reconecte a conta.`;
        await repository.setStatus(organizationId, provider, "EXPIRED", expiredReason);
        throw new MarketplaceError(expiredReason, provider);
      }

      const refreshToken = decryptConnectorSecret(connector.refreshToken);
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
          const { refreshMercadoLivreToken, getMercadoLivreConfig } = await import(
            "../mercadolivre/mercadolivre.service"
          );
          const meliConfig = getMercadoLivreConfig();
          const tokens = await refreshMercadoLivreToken(refreshToken, meliConfig);
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
        const failReason =
          provider === "MERCADOLIVRE"
            ? "Aguardando autenticação da conta de desenvolvedor"
            : "A renovação do token falhou — reconecte a conta.";
        await repository.setStatus(
          organizationId,
          provider,
          "EXPIRED",
          failReason,
        );
        if (provider === "MERCADOLIVRE") {
          throw new MarketplaceError(failReason, provider);
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
