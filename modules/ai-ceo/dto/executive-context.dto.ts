/**
 * Stable, JSON-safe input contract consumed by the AI CEO engines.
 *
 * Database records are projected into this shape before they reach a prompt:
 * no credentials, tokens, personal contact data or Prisma relations can leak
 * into the OpenAI request. Monetary values are integer cents and rates are
 * integer basis points.
 */

export interface ExecutiveAnalyticsSnapshot {
  id: string;
  from: string;
  to: string;
  computedAt: string;
  gmvCents: number;
  grossMarginCents: number;
  roiBps: number;
  paidOrders: number;
}

export interface ExecutiveCampaign {
  id: string;
  name: string;
  status: string;
  budgetCents: number;
  revenueCents: number;
  roiBps: number;
  targetRoiBps: number;
  creatorCount: number;
  productCount: number;
}

export interface ExecutiveCreator {
  id: string;
  name: string;
  niche: string;
  score: number;
  status: string;
  avgViews: number;
  outreachCount: number;
  potentialRevenueCents: number;
}

export interface ExecutiveProduct {
  id: string;
  name: string;
  status: string;
  priceCents: number;
  marginBps: number;
  stockQuantity: number;
  creatorCount: number;
  revenueCents: number;
  potentialRevenueCents: number;
}

export interface ExecutiveTrend {
  id: string;
  keyword: string;
  category: string;
  trendScore: number;
  previousScore: number | null;
  growthBps: number;
  hasCampaign: boolean;
  potentialRevenueCents: number;
}

export interface ExecutiveOutreach {
  total: number;
  drafts: number;
  ready: number;
  scheduled: number;
  sent: number;
  failed: number;
}

export interface ExecutiveDelivery {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRateBps: number;
  readRateBps: number;
}

export interface ExecutiveContext {
  generatedAt: string;
  analytics: ExecutiveAnalyticsSnapshot;
  campaigns: ExecutiveCampaign[];
  creators: ExecutiveCreator[];
  products: ExecutiveProduct[];
  trends: ExecutiveTrend[];
  outreach: ExecutiveOutreach;
  delivery: ExecutiveDelivery;
}
