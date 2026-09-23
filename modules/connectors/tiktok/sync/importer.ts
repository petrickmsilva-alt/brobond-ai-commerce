import "server-only";

import type { Prisma, PrismaClient, TikTokAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import { getCreators } from "../api/creators";
import { TikTokApiClient, getTikTokApiConfig } from "../api/client";
import { getOrders } from "../api/orders";
import { getProducts } from "../api/products";
import { tiktokOAuthService } from "../auth/oauth.service";
import { tiktokTokenRepository } from "../auth/token.service";
import type { TikTokSyncResult } from "../dto";
import {
  mapTikTokCreator,
  mapTikTokProduct,
  mapTikTokProductExternalContent,
  type TikTokCreatorImport,
  type TikTokProductImport,
} from "./mapper";

const MAX_PAGES_PER_RESOURCE = 10;

export type TikTokImportDatabase = Pick<
  PrismaClient,
  "product" | "creatorProfile" | "externalContent" | "auditLog"
>;

export function createTikTokImportRepository(db: TikTokImportDatabase) {
  return {
    async upsertProduct(organizationId: string, product: TikTokProductImport) {
      const existing = await db.product.findFirst({
        where: scopedWhere(organizationId, { tiktokProductId: product.tiktokProductId }),
      });
      if (existing) {
        await db.product.update({
          where: { id: existing.id },
          data: {
            name: product.name,
            description: product.description,
            priceCents: product.priceCents,
            currency: product.currency,
            imageUrl: product.imageUrl,
            stockQuantity: product.stockQuantity,
            status: product.status,
          },
        });
        return { created: false };
      }
      await db.product.create({
        data: { ...product, ...tenantWhere(organizationId) },
      });
      return { created: true };
    },

    async upsertCreator(organizationId: string, creator: TikTokCreatorImport) {
      const existing = await db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, { source: "TIKTOK", externalId: creator.externalId }),
      });
      if (existing) {
        await db.creatorProfile.update({
          where: { id: existing.id },
          data: {
            displayName: creator.displayName,
            avatarUrl: creator.avatarUrl,
            bio: creator.bio,
            followers: creator.followers,
            avgViews: creator.avgViews,
            engagementRate: creator.engagementRate,
            niche: creator.niche,
            creatorScore: creator.creatorScore,
          },
        });
        return { created: false };
      }

      // Handles are tenant-unique across manual and every discovery source.
      // Preserve a human's handle and use an external-id suffix only on a
      // genuine collision; source+externalId still remains the idempotency key.
      const handleOwner = await db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, { handle: creator.handle }),
        select: { id: true },
      });
      const handle = handleOwner
        ? `${creator.handle}-tt-${creator.externalId.slice(-8)}`
        : creator.handle;
      await db.creatorProfile.create({
        data: {
          ...creator,
          handle,
          source: "TIKTOK",
          status: "NEW",
          ...tenantWhere(organizationId),
        },
      });
      return { created: true };
    },

    async upsertExternalContent(
      organizationId: string,
      content: ReturnType<typeof mapTikTokProductExternalContent>,
    ) {
      const existing = await db.externalContent.findFirst({
        where: scopedWhere(organizationId, { platform: "TIKTOK", externalId: content.externalId }),
      });
      if (existing) {
        await db.externalContent.update({
          where: { id: existing.id },
          data: {
            title: content.title,
            thumbnailUrl: content.thumbnailUrl,
            caption: content.caption,
            raw: content.raw as Prisma.InputJsonValue,
          },
        });
        return { created: false };
      }
      await db.externalContent.create({
        data: { ...content, ...tenantWhere(organizationId) },
      });
      return { created: true };
    },

    audit(organizationId: string, action: string, metadata: Prisma.InputJsonValue) {
      return db.auditLog.create({
        data: { organizationId, action, entityType: "TikTokSync", metadata },
      });
    },
  };
}

export interface TikTokImporterDependencies {
  db?: TikTokImportDatabase;
  listAccounts?: (organizationId: string) => Promise<TikTokAccount[]>;
  getAccessToken?: (organizationId: string, account: TikTokAccount) => Promise<string>;
  markSynced?: (organizationId: string, accountId: string, at: Date) => Promise<void>;
  client?: () => TikTokApiClient;
  now?: () => Date;
}

/**
 * Imports exclusively from TikTok Shop's official API. All three persistence
 * targets are idempotent: Product uses (tenant,tiktokProductId), Creator uses
 * (tenant,TIKTOK,externalId), and ExternalContent uses its existing connector
 * composite key.
 */
export function createTikTokImporter(deps: TikTokImporterDependencies = {}) {
  const repository = createTikTokImportRepository(deps.db ?? prisma);
  const listAccounts =
    deps.listAccounts ?? ((organizationId) => tiktokTokenRepository.findConnected(organizationId));
  const getAccessToken =
    deps.getAccessToken ??
    ((organizationId, account) => tiktokOAuthService.getValidAccessToken(organizationId, account));
  const markSynced =
    deps.markSynced ??
    ((organizationId, accountId, at) =>
      tiktokTokenRepository.markSynced(organizationId, accountId, at));
  const client = deps.client ?? (() => new TikTokApiClient(getTikTokApiConfig()));
  const now = deps.now ?? (() => new Date());

  return {
    async sync(organizationId: string): Promise<TikTokSyncResult> {
      tenantWhere(organizationId);
      const started = now();
      const result: TikTokSyncResult = {
        accounts: 0,
        products: { created: 0, updated: 0 },
        creators: { created: 0, updated: 0 },
        externalContents: { created: 0, updated: 0 },
        ordersFetched: 0,
        startedAt: started.toISOString(),
        finishedAt: started.toISOString(),
      };
      const accounts = await listAccounts(organizationId);
      if (accounts.length === 0)
        throw new Error("No connected TikTok Shop account was found for this workspace.");

      for (const account of accounts) {
        const accessToken = await getAccessToken(organizationId, account);
        const api = client();
        result.accounts += 1;

        let productToken: string | undefined;
        for (let page = 0; page < MAX_PAGES_PER_RESOURCE; page += 1) {
          const response = await getProducts(api, {
            accessToken,
            shopCipher: account.shopCipher,
            pageToken: productToken,
          });
          for (const source of response.products) {
            const product = mapTikTokProduct(source);
            const productWrite = await repository.upsertProduct(organizationId, product);
            if (productWrite.created) result.products.created += 1;
            else result.products.updated += 1;

            const contentWrite = await repository.upsertExternalContent(
              organizationId,
              mapTikTokProductExternalContent(source, account.shopId),
            );
            if (contentWrite.created) result.externalContents.created += 1;
            else result.externalContents.updated += 1;
          }
          productToken = response.nextPageToken;
          if (!productToken) break;
        }

        let creatorToken: string | undefined;
        for (let page = 0; page < MAX_PAGES_PER_RESOURCE; page += 1) {
          const response = await getCreators(api, {
            accessToken,
            shopCipher: account.shopCipher,
            pageToken: creatorToken,
          });
          for (const source of response.creators) {
            const creatorWrite = await repository.upsertCreator(
              organizationId,
              mapTikTokCreator(source),
            );
            if (creatorWrite.created) result.creators.created += 1;
            else result.creators.updated += 1;
          }
          creatorToken = response.nextPageToken;
          if (!creatorToken) break;
        }

        // Orders are read through the official Orders API for operational
        // reconciliation. They are not converted to Sale here because an order
        // item/product mapping policy belongs to the finance domain.
        const orders = await getOrders(api, {
          accessToken,
          shopCipher: account.shopCipher,
          updatedSince: account.lastSync ?? undefined,
        });
        result.ordersFetched += orders.orders.length;
        await markSynced(organizationId, account.id, now());
      }

      result.finishedAt = now().toISOString();
      await repository.audit(organizationId, "TIKTOK_SYNC_COMPLETED", {
        accounts: result.accounts,
        products: result.products,
        creators: result.creators,
        externalContents: result.externalContents,
        ordersFetched: result.ordersFetched,
      });
      return result;
    },
  };
}

export const tiktokImporter = createTikTokImporter();
