import type { ExecutiveContext } from "@/modules/ai-ceo/dto";

export function executiveContextFixture(): ExecutiveContext {
  return {
    generatedAt: "2026-09-23T12:00:00.000Z",
    analytics: {
      id: "snapshot_1",
      from: "2026-08-25T00:00:00.000Z",
      to: "2026-09-24T00:00:00.000Z",
      computedAt: "2026-09-23T11:55:00.000Z",
      gmvCents: 10_000_000,
      grossMarginCents: 5_500_000,
      roiBps: 5_500,
      paidOrders: 100,
    },
    campaigns: [
      {
        id: "campaign_1",
        name: "Campanha abaixo da meta",
        status: "RUNNING",
        budgetCents: 1_000_000,
        revenueCents: 500_000,
        roiBps: -5_000,
        targetRoiBps: 3_000,
        creatorCount: 2,
        productCount: 1,
      },
    ],
    creators: [
      {
        id: "creator_1",
        name: "Creator Premium",
        niche: "Moda",
        score: 92,
        status: "QUALIFIED",
        avgViews: 250_000,
        outreachCount: 0,
        potentialRevenueCents: 750_000,
      },
    ],
    products: [
      {
        id: "product_1",
        name: "Produto Margem Alta",
        status: "ACTIVE",
        priceCents: 25_000,
        marginBps: 6_500,
        stockQuantity: 100,
        creatorCount: 1,
        revenueCents: 1_000_000,
        potentialRevenueCents: 5_000_000,
      },
    ],
    trends: [
      {
        id: "trend_1",
        keyword: "Street premium",
        category: "Moda",
        trendScore: 85,
        previousScore: 60,
        growthBps: 4_167,
        hasCampaign: false,
        potentialRevenueCents: 2_000_000,
      },
    ],
    outreach: {
      total: 50,
      drafts: 5,
      ready: 25,
      scheduled: 5,
      sent: 15,
      failed: 0,
    },
    delivery: {
      queued: 5,
      sent: 90,
      delivered: 80,
      read: 60,
      failed: 10,
      deliveryRateBps: 8_889,
      readRateBps: 7_500,
    },
  };
}
