import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { SaveAudienceItem } from "../dto/campaign.dto";

export type AudienceDatabase = Pick<
  PrismaClient,
  "campaignAudience" | "campaign" | "creatorProfile" | "product"
>;

const AUDIENCE_INCLUDE = {
  creator: true,
  product: true,
  campaign: true,
} satisfies Prisma.CampaignAudienceInclude;

export type CampaignAudienceRow = Prisma.CampaignAudienceGetPayload<{
  include: typeof AUDIENCE_INCLUDE;
}>;

export function createCampaignAudienceRepository(db: AudienceDatabase) {
  return {
    async saveAudience(
      organizationId: string,
      campaignId: string,
      items: readonly SaveAudienceItem[],
    ) {
      tenantWhere(organizationId);
      const campaign = await db.campaign.findFirst({
        where: scopedWhere(organizationId, { id: campaignId }),
      });
      if (!campaign) return [];

      const deduped = [
        ...new Map(items.map((item) => [`${item.creatorId}:${item.productId}`, item])).values(),
      ].filter((item) => item.campaignId === campaignId);
      const [creators, products] = await Promise.all([
        db.creatorProfile.findMany({
          where: scopedWhere(organizationId, { id: { in: deduped.map((item) => item.creatorId) } }),
          select: { id: true },
        }),
        db.product.findMany({
          where: scopedWhere(organizationId, { id: { in: deduped.map((item) => item.productId) } }),
          select: { id: true },
        }),
      ]);
      const creatorIds = new Set(creators.map(({ id }) => id));
      const productIds = new Set(products.map(({ id }) => id));
      const safe = deduped.filter(
        (item) => creatorIds.has(item.creatorId) && productIds.has(item.productId),
      );
      // A guessed/foreign endpoint invalidates the whole replacement. Never
      // let a cross-tenant payload wipe a valid audience as a side effect.
      if (safe.length !== deduped.length) return [];

      await db.campaignAudience.deleteMany({ where: scopedWhere(organizationId, { campaignId }) });
      if (safe.length) {
        await db.campaignAudience.createMany({
          data: safe.map((item) => ({
            ...item,
            organizationId,
            matchScore: Math.min(100, Math.max(0, Math.round(item.matchScore))),
          })),
        });
      }
      return db.campaignAudience.findMany({
        where: scopedWhere(organizationId, { campaignId }),
        include: AUDIENCE_INCLUDE,
        orderBy: [{ matchScore: "desc" }, { creatorId: "asc" }, { productId: "asc" }],
      });
    },

    listAudience(organizationId: string, campaignId?: string) {
      return db.campaignAudience.findMany({
        where: scopedWhere(organizationId, campaignId ? { campaignId } : {}),
        include: AUDIENCE_INCLUDE,
        orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
      });
    },

    listRecommendations(organizationId: string, campaignId?: string) {
      return db.campaignAudience.findMany({
        where: scopedWhere(organizationId, {
          recommended: true,
          ...(campaignId ? { campaignId } : {}),
        }),
        include: AUDIENCE_INCLUDE,
        orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
      });
    },
  };
}

export const campaignAudienceRepository = createCampaignAudienceRepository(prisma);
