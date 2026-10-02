import "server-only";

import type { ConnectorPlatform, ConnectorProvider } from "@prisma/client";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import {
  toCreateExternalContentDTO,
  type CreateExternalContentDTO,
} from "@/modules/connectors/core/connector.dto";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";
import { marketplaceRepository, type MarketplaceRepository } from "./connector.repository";
import { marketplaceService, type createMarketplaceService } from "./connector.service";
import { ConnectorNotConnectedError, MarketplaceError } from "./errors";
import type { MarketplaceSyncResultDTO } from "./connector.dto";
import { fetchInstagramContent } from "../instagram/instagram-bridge.service";
import { fetchTikTokContent } from "../tiktok/tiktok-bridge.service";
import { fetchShopeeProducts } from "../shopee/shopee.service";
import { fetchMercadoLivreItems } from "../mercadolivre/mercadolivre.service";
import { fetchMercadoPagoPayments } from "../mercadopago/mercadopago.service";
import {
  getMercadoPagoEnvironmentCredentials,
  hasPersistedMercadoPagoCredentials,
  type MercadoPagoEnvironment,
} from "../mercadopago/credentials";

/**
 * Marketplace sync service (PR012) — the real "Sincronizar" path.
 *
 * For one provider inside one tenant:
 *   1. resolve a VALID credential (transparent refresh for Shopee / Mercado
 *      Livre; PR009/PR010 bridges for TikTok / Instagram);
 *   2. fetch the live catalog/billing feed from the official API, already
 *      normalized;
 *   3. upsert every item into `ExternalContent` on the tenant-scoped dedupe
 *      key — first sight IMPORTED, re-sight DUPLICATE (metrics refreshed),
 *      per-item failure FAILED with its reason;
 *   4. increment the consolidated counters on BOTH the unified `Connector`
 *      row and the PR005 `ConnectorStatus` row (single KPI source of truth);
 *   5. return the run counters for instant dashboard feedback.
 */

/** Map the unified provider onto the PR005 framework platform enum. */
const PROVIDER_TO_PLATFORM: Record<ConnectorProvider, ConnectorPlatform> = {
  TIKTOK: "TIKTOK",
  INSTAGRAM: "INSTAGRAM",
  SHOPEE: "SHOPEE",
  MERCADOLIVRE: "MERCADOLIVRE",
  MERCADOPAGO: "MERCADOPAGO",
};

export interface MarketplaceSyncDependencies {
  repository?: MarketplaceRepository;
  service?: ReturnType<typeof createMarketplaceService>;
  env?: MercadoPagoEnvironment;
}

async function fetchProviderContent(
  organizationId: string,
  provider: ConnectorProvider,
  limit: number,
  service: ReturnType<typeof createMarketplaceService>,
): Promise<NormalizedContent[]> {
  switch (provider) {
    case "TIKTOK":
      return fetchTikTokContent(organizationId, limit);
    case "INSTAGRAM":
      return fetchInstagramContent(organizationId, limit);
    case "SHOPEE": {
      const { accessToken, shopId } = await service.getValidAccessToken(organizationId, provider);
      if (!shopId) throw new ConnectorNotConnectedError(provider);
      return fetchShopeeProducts(accessToken, shopId, limit);
    }
    case "MERCADOLIVRE": {
      const { accessToken, shopId } = await service.getValidAccessToken(organizationId, provider);
      if (!shopId) throw new ConnectorNotConnectedError(provider);
      return fetchMercadoLivreItems(accessToken, shopId, limit);
    }
    case "MERCADOPAGO": {
      const { accessToken } = await service.getValidAccessToken(organizationId, provider);
      return fetchMercadoPagoPayments(accessToken, limit);
    }
    default:
      throw new MarketplaceError(`Provedor não suportado: ${String(provider)}.`);
  }
}

export function createMarketplaceSyncService(deps: MarketplaceSyncDependencies = {}) {
  const repository = deps.repository ?? marketplaceRepository;
  const service = deps.service ?? marketplaceService;
  const env = deps.env ?? process.env;

  return {
    async syncProvider(
      organizationId: string,
      provider: ConnectorProvider,
      limit: number,
    ): Promise<MarketplaceSyncResultDTO> {
      const platform = PROVIDER_TO_PLATFORM[provider];

      // The connection must be usable before any network call. Mercado Pago
      // remains usable when the complete credential pair comes from Render,
      // even if this tenant does not yet have a unified Connector row.
      const connector = await repository.findByProvider(organizationId, provider);
      if (provider === "MERCADOLIVRE") {
        const configured = Boolean(
          process.env.MERCADOLIVRE_CLIENT_ID?.trim() && process.env.MERCADOLIVRE_CLIENT_SECRET?.trim(),
        );
        if (!configured || !connector || connector.status !== "CONNECTED" || !connector.accessToken) {
          const reason = "Aguardando autenticação da conta de desenvolvedor";
          await repository.recordSyncResult(organizationId, provider, {
            status: "ERROR",
            counters: { imported: 0, duplicated: 0, failed: 0 },
            lastError: reason,
          });
          await connectorRepository.recordSyncResult(organizationId, platform, {
            state: "ERROR",
            counters: { imported: 0, duplicates: 0, failed: 0 },
            lastError: reason,
          });
          throw new MarketplaceError(reason, provider);
        }
      } else if (provider === "MERCADOPAGO") {
        const configured =
          hasPersistedMercadoPagoCredentials(connector) ||
          getMercadoPagoEnvironmentCredentials(env) !== null;
        if (!configured) throw new ConnectorNotConnectedError(provider);
      } else if (provider !== "TIKTOK" && provider !== "INSTAGRAM") {
        if (!connector || connector.status !== "CONNECTED" || !connector.accessToken) {
          throw new ConnectorNotConnectedError(provider);
        }
      }

      // Ensure the metrics row before fetching so an environment-only
      // Mercado Pago failure is durable and visible on the next card load.
      const statusRow = await connectorRepository.ensureStatus(organizationId, platform);

      let items: NormalizedContent[];
      try {
        items = await fetchProviderContent(organizationId, provider, limit, service);
      } catch (error) {
        let message =
          error instanceof Error ? error.message : "Falha desconhecida na sincronização.";
        if (
          provider === "MERCADOLIVRE" &&
          (message.includes("autenticação") ||
            message.includes("obrigatória") ||
            message.includes("expirou") ||
            message.includes("credencial") ||
            message.includes("401") ||
            message.includes("403") ||
            message.includes("MERCADOLIVRE_CLIENT_SECRET") ||
            message.includes("MERCADOLIVRE_CLIENT_ID"))
        ) {
          message = "Aguardando autenticação da conta de desenvolvedor";
        }
        // Record the failure on BOTH stores so the cards show a real ERROR.
        await repository.recordSyncResult(organizationId, provider, {
          status: "ERROR",
          counters: { imported: 0, duplicated: 0, failed: 0 },
          lastError: message.slice(0, 500),
        });
        await connectorRepository.recordSyncResult(organizationId, platform, {
          state: "ERROR",
          counters: { imported: 0, duplicates: 0, failed: 0 },
          lastError: message.slice(0, 500),
        });
        if (provider === "MERCADOLIVRE" && message === "Aguardando autenticação da conta de desenvolvedor") {
          throw new MarketplaceError(message, provider);
        }
        throw error;
      }

      // Ingest onto the tenant-scoped dedupe key — same contract as PR005.
      let imported = 0;
      let duplicated = 0;
      let failed = 0;

      for (const item of items) {
        try {
          const existing = await connectorRepository.findContentByExternalId(
            organizationId,
            platform,
            item.externalId,
          );
          if (existing) {
            await connectorRepository.refreshContent(organizationId, existing.id, {
              views: item.views ?? 0,
              likes: item.likes ?? 0,
              shares: item.shares ?? 0,
              title: item.title,
            });
            duplicated += 1;
            continue;
          }
          const dto: CreateExternalContentDTO = toCreateExternalContentDTO(
            item,
            platform,
            "IMPORTED",
            { connectorStatusId: statusRow.id },
          );
          await connectorRepository.createContent(organizationId, dto);
          imported += 1;
        } catch (error) {
          failed += 1;
          try {
            const dto = toCreateExternalContentDTO(item, platform, "FAILED", {
              connectorStatusId: statusRow.id,
              errorReason:
                error instanceof Error ? error.message.slice(0, 500) : "Falha ao importar o item.",
            });
            await connectorRepository.createContent(organizationId, dto);
          } catch {
            // A FAILED row that cannot be persisted (e.g. dedupe collision)
            // must never abort the run — the counter already reflects it.
          }
        }
      }

      const syncedAt = new Date();
      await repository.recordSyncResult(organizationId, provider, {
        status: "CONNECTED",
        counters: { imported, duplicated, failed },
        syncedAt,
      });
      await connectorRepository.recordSyncResult(organizationId, platform, {
        state: "ACTIVE",
        counters: { imported, duplicates: duplicated, failed },
        syncedAt,
      });

      return { provider, imported, duplicated, failed, syncedAt: syncedAt.toISOString() };
    },
  };
}

export const marketplaceSyncService = createMarketplaceSyncService();
