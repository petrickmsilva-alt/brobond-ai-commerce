import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId, tenantWhere } from "@/lib/tenant";
import type { AnalyticsDashboardData } from "@/modules/analytics/services/analytics.service";
import type {
  ExecutiveContext,
  ExecutiveDelivery,
  ExecutiveOutreach,
  ExecutiveTrend,
} from "../dto";

export const DEFAULT_CAMPAIGN_ROI_TARGET_BPS = 3_000;

export type AICeoContextDatabase = Pick<
  PrismaClient,
  | "analyticsSnapshot"
  | "campaign"
  | "creatorProfile"
  | "product"
  | "trendSnapshot"
  | "outreachMessage"
  | "deliveryMessage"
>;

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function safeCents(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function groupedCounts(rows: Array<{ status: string; _count: { _all: number } }>) {
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all])) as Record<
    string,
    number
  >;
}

/** Tenant-scoped projection from operational tables into a prompt-safe DTO. */
export function createAICeoContextRepository(db: AICeoContextDatabase) {
  return {
    async load(
      organizationId: string,
      analytics: AnalyticsDashboardData,
      now = new Date(),
    ): Promise<ExecutiveContext> {
      const organization = assertOrganizationId(organizationId);
      const scope = tenantWhere(organization);
      const from = new Date(analytics.period.from);
      const to = new Date(analytics.period.to);

      const [snapshot, products, creators, campaigns, trendRows, outreachRows, deliveryRows] =
        await Promise.all([
          db.analyticsSnapshot.findUnique({
            where: { organizationId_from_to: { organizationId: organization, from, to } },
            select: { id: true },
          }),
          db.product.findMany({
            where: scope,
            select: {
              id: true,
              name: true,
              status: true,
              priceCents: true,
              marginBps: true,
              stockQuantity: true,
              _count: { select: { campaignAudiences: true } },
            },
            orderBy: [{ marginBps: "desc" }, { id: "asc" }],
          }),
          db.creatorProfile.findMany({
            where: scope,
            select: {
              id: true,
              displayName: true,
              niche: true,
              creatorScore: true,
              status: true,
              avgViews: true,
              _count: { select: { outreachMessages: true } },
            },
            orderBy: [{ creatorScore: "desc" }, { id: "asc" }],
          }),
          db.campaign.findMany({
            where: scope,
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              budgetCents: true,
              _count: { select: { creators: true, products: true } },
            },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          }),
          db.trendSnapshot.findMany({
            where: scope,
            select: {
              id: true,
              keyword: true,
              category: true,
              trendScore: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: 500,
          }),
          db.outreachMessage.groupBy({
            by: ["status"],
            where: scope,
            _count: { _all: true },
          }),
          db.deliveryMessage.groupBy({
            by: ["status"],
            where: scope,
            _count: { _all: true },
          }),
        ]);

      const productRevenue = new Map(
        analytics.metrics.attribution.byProduct.map((row) => [row.key, row.revenueCents]),
      );
      const campaignRevenue = new Map(
        analytics.metrics.attribution.byCampaign.map((row) => [row.key, row.revenueCents]),
      );
      const averageTicket = analytics.metrics.totals.avgTicketCents;

      const campaignTerms = campaigns
        .filter((campaign) => ["SCHEDULED", "RUNNING"].includes(campaign.status))
        .map((campaign) => normalize(`${campaign.name} ${campaign.description ?? ""}`));

      const trendsByKeyword = new Map<string, typeof trendRows>();
      for (const row of trendRows) {
        const key = normalize(row.keyword);
        const existing = trendsByKeyword.get(key) ?? [];
        existing.push(row);
        trendsByKeyword.set(key, existing);
      }

      const trends: ExecutiveTrend[] = [];
      for (const rows of trendsByKeyword.values()) {
        const latest = rows[0];
        if (!latest) continue;
        const previous = rows[1] ?? null;
        const growthBps = previous
          ? Math.round(
              ((latest.trendScore - previous.trendScore) / Math.max(1, previous.trendScore)) *
                10_000,
            )
          : 0;
        const keyword = normalize(latest.keyword);
        const category = normalize(latest.category);
        trends.push({
          id: latest.id,
          keyword: latest.keyword,
          category: latest.category,
          trendScore: latest.trendScore,
          previousScore: previous?.trendScore ?? null,
          growthBps,
          hasCampaign: campaignTerms.some(
            (text) => text.includes(keyword) || text.includes(category),
          ),
          potentialRevenueCents: safeCents(
            averageTicket * Math.max(5, Math.round(latest.trendScore / 5)),
          ),
        });
      }
      trends.sort(
        (left, right) => right.trendScore - left.trendScore || left.id.localeCompare(right.id),
      );

      const outreach = groupedCounts(
        outreachRows as Array<{ status: string; _count: { _all: number } }>,
      );
      const outreachSummary: ExecutiveOutreach = {
        total: Object.values(outreach).reduce((sum, count) => sum + count, 0),
        drafts: outreach.DRAFT ?? 0,
        ready: outreach.READY ?? 0,
        scheduled: outreach.SCHEDULED ?? 0,
        sent: outreach.SENT ?? 0,
        failed: outreach.FAILED ?? 0,
      };

      const delivery = groupedCounts(
        deliveryRows as Array<{ status: string; _count: { _all: number } }>,
      );
      const sent = (delivery.SENT ?? 0) + (delivery.DELIVERED ?? 0) + (delivery.READ ?? 0);
      const delivered = (delivery.DELIVERED ?? 0) + (delivery.READ ?? 0);
      const read = delivery.READ ?? 0;
      const deliverySummary: ExecutiveDelivery = {
        queued: (delivery.QUEUED ?? 0) + (delivery.SENDING ?? 0),
        sent,
        delivered,
        read,
        failed: delivery.FAILED ?? 0,
        deliveryRateBps: sent > 0 ? Math.round((delivered / sent) * 10_000) : 0,
        readRateBps: delivered > 0 ? Math.round((read / delivered) * 10_000) : 0,
      };

      return {
        generatedAt: now.toISOString(),
        analytics: {
          id: snapshot?.id ?? `analytics:${analytics.period.from}:${analytics.period.to}`,
          from: analytics.period.from,
          to: analytics.period.to,
          computedAt: analytics.computedAt,
          gmvCents: analytics.metrics.totals.revenueCents,
          grossMarginCents: analytics.metrics.totals.grossMarginCents,
          roiBps: analytics.metrics.roiBps,
          paidOrders: analytics.metrics.totals.paidCount,
        },
        campaigns: campaigns.map((campaign) => {
          const revenueCents = campaignRevenue.get(campaign.id) ?? 0;
          const roiBps =
            campaign.budgetCents > 0
              ? Math.round(((revenueCents - campaign.budgetCents) / campaign.budgetCents) * 10_000)
              : analytics.metrics.roiBps;
          return {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            budgetCents: campaign.budgetCents,
            revenueCents,
            roiBps,
            targetRoiBps: DEFAULT_CAMPAIGN_ROI_TARGET_BPS,
            creatorCount: campaign._count.creators,
            productCount: campaign._count.products,
          };
        }),
        creators: creators.map((creator) => ({
          id: creator.id,
          name: creator.displayName,
          niche: creator.niche,
          score: creator.creatorScore,
          status: creator.status,
          avgViews: creator.avgViews,
          outreachCount: creator._count.outreachMessages,
          potentialRevenueCents: safeCents(creator.avgViews * 3),
        })),
        products: products.map((product) => ({
          id: product.id,
          name: product.name,
          status: product.status,
          priceCents: product.priceCents,
          marginBps: product.marginBps,
          stockQuantity: product.stockQuantity,
          creatorCount: product._count.campaignAudiences,
          revenueCents: productRevenue.get(product.id) ?? 0,
          potentialRevenueCents: safeCents(
            product.priceCents *
              Math.min(100, product.stockQuantity) *
              (Math.max(0, product.marginBps) / 10_000),
          ),
        })),
        trends,
        outreach: outreachSummary,
        delivery: deliverySummary,
      };
    },
  };
}

export const aiCeoContextRepository = createAICeoContextRepository(prisma);
