import "server-only";

import { CreatorStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere } from "@/lib/tenant";
import { recommendCreators } from "../matching/matcher";
import { campaignAudienceRepository } from "../repositories/campaign-audience.repository";

/**
 * Rebuild one campaign audience from tenant-owned data. No network, provider,
 * messaging or random source is involved: identical database snapshots yield
 * an identical ranked audience.
 */
export async function buildCampaign(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: scopedWhere(organizationId, { id: campaignId }),
    include: { products: { include: { product: true } }, rule: true },
  });
  if (!campaign) return null;

  const [creators, productMatches, trends] = await Promise.all([
    prisma.creatorProfile.findMany({
      where: scopedWhere(organizationId, { status: { not: CreatorStatus.ARCHIVED } }),
    }),
    prisma.productMatch.findMany({
      where: scopedWhere(organizationId, {
        productId: { in: campaign.products.map(({ productId }) => productId) },
      }),
    }),
    prisma.trendSnapshot.findMany({ where: scopedWhere(organizationId, {}) }),
  ]);

  const recommendations = recommendCreators(
    campaign,
    campaign.products.map(({ product }) => product),
    creators,
    productMatches,
    trends,
    campaign.rule ?? {},
  );
  return campaignAudienceRepository.saveAudience(organizationId, campaign.id, recommendations);
}
