/**
 * Personalization context builder — PR007 (AI Personalization Engine).
 *
 * Pure, framework-free module: takes the domain records (Creator, Product,
 * Campaign, and an optional Trend) and produces a single structured
 * `PersonalizationContext` object that both the prompt builder
 * (`modules/ai/openai/prompts.ts`) and the cache-key hasher
 * (`buildContextHash`) consume.
 *
 * Deliberately has NO dependency on Prisma types — callers pass plain
 * objects (usually the result of a `select` projection), which keeps this
 * module trivially unit-testable and decoupled from the ORM.
 */

export interface CreatorContextInput {
  id: string;
  displayName: string;
  handle: string;
  niche: string;
  engagementRate?: number | null;
  avgViews?: number | null;
}

export interface ProductContextInput {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  currency?: string | null;
}

export interface CampaignContextInput {
  id: string;
  name: string;
  goal?: string | null;
}

export interface TrendContextInput {
  keyword: string;
  category?: string | null;
  score?: number | null;
}

export interface PersonalizationContextInput {
  creator: CreatorContextInput;
  product: ProductContextInput;
  campaign: CampaignContextInput;
  /** Trend is optional — not every campaign is trend-driven. */
  trend?: TrendContextInput | null;
}

export interface PersonalizationContext {
  creator: {
    id: string;
    name: string;
    handle: string;
    niche: string;
    engagementRate: number;
    avgViews: number;
  };
  product: {
    id: string;
    name: string;
    description: string;
    priceCents: number;
    currency: string;
  };
  campaign: {
    id: string;
    name: string;
    goal: string;
  };
  trend: {
    keyword: string;
    category: string;
    score: number;
  } | null;
}

/** Build the structured context object passed to the prompt builder. */
export function buildPersonalizationContext(
  input: PersonalizationContextInput,
): PersonalizationContext {
  const { creator, product, campaign, trend } = input;

  return {
    creator: {
      id: creator.id,
      name: creator.displayName,
      handle: creator.handle,
      niche: creator.niche,
      engagementRate: creator.engagementRate ?? 0,
      avgViews: creator.avgViews ?? 0,
    },
    product: {
      id: product.id,
      name: product.name,
      description: product.description ?? "",
      priceCents: product.priceCents ?? 0,
      currency: product.currency ?? "BRL",
    },
    campaign: {
      id: campaign.id,
      name: campaign.name,
      goal: campaign.goal ?? "",
    },
    trend: trend
      ? {
          keyword: trend.keyword,
          category: trend.category ?? "",
          score: trend.score ?? 0,
        }
      : null,
  };
}

/**
 * Deterministic, order-independent serialization of a context object plus
 * the prompt version, used as the input to the cache-key hash
 * (see `modules/ai/personalization/message.service.ts#buildContextHash`).
 */
export function serializeContextForHash(
  context: PersonalizationContext,
  promptVersion: string,
): string {
  const ordered = {
    promptVersion,
    creator: {
      id: context.creator.id,
      name: context.creator.name,
      handle: context.creator.handle,
      niche: context.creator.niche,
      engagementRate: context.creator.engagementRate,
      avgViews: context.creator.avgViews,
    },
    product: {
      id: context.product.id,
      name: context.product.name,
      description: context.product.description,
      priceCents: context.product.priceCents,
      currency: context.product.currency,
    },
    campaign: {
      id: context.campaign.id,
      name: context.campaign.name,
      goal: context.campaign.goal,
    },
    trend: context.trend
      ? {
          keyword: context.trend.keyword,
          category: context.trend.category,
          score: context.trend.score,
        }
      : null,
  };
  return JSON.stringify(ordered);
}
