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
  /**
   * PR007.1 — weighted 0–100 creator score (`CreatorProfile.creatorScore`).
   * Audit-only: consumed by `serializeContext()` for the persisted context
   * snapshot. NEVER part of the prompt context or the cache-key hash, so
   * PR007's cache contract is untouched.
   */
  score?: number | null;
}

export interface ProductContextInput {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  /**
   * PR007.1 — gross margin in basis points (`Product.marginBps`,
   * e.g. 3550 = 35.50%). Audit-only: consumed by `serializeContext()` for
   * the persisted context snapshot. NEVER part of the prompt context or
   * the cache-key hash, so PR007's cache contract is untouched.
   */
  margin?: number | null;
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
 * PR007.1 — AI Context Audit.
 *
 * Stable, JSON-serializable snapshot of the full structured context used to
 * generate an AI message. Persisted verbatim on `AIGeneratedMessage
 * .contextSnapshot` at generation time so every stored message can answer
 * "which creator/product/campaign/trend state produced this content?".
 *
 * The shape is deliberately minimal and FROZEN (fixed key order: creator →
 * product → campaign → trend) so two snapshots can be diffed deterministically
 * with `compareContextSnapshots()` (`modules/ai/audit/context-diff.ts`).
 *
 * Fields:
 *   creator — id · name · handle · niche · score (CreatorProfile.creatorScore)
 *   product — id · name · margin (Product.marginBps, basis points)
 *   campaign — id · name
 *   trend — keyword · score (null when the generation was not trend-driven)
 *
 * Optional inputs that were not captured at call time serialize as `null`
 * (never omitted), keeping the snapshot shape identical across rows.
 *
 * ⚠️ CACHE INVARIANT: this function is AUDIT-ONLY. It must NEVER be used to
 * compute `contextHash` — the cache key remains `serializeContextForHash()`
 * exactly as shipped in PR007. Changing that would silently invalidate the
 * whole generation cache.
 */
export interface ContextSnapshot {
  creator: {
    id: string;
    name: string;
    handle: string;
    niche: string;
    score: number | null;
  };
  product: {
    id: string;
    name: string;
    margin: number | null;
  };
  campaign: {
    id: string;
    name: string;
  };
  trend: {
    keyword: string;
    score: number | null;
  } | null;
}

/**
 * Serialize the parse-time context input into the stable audit snapshot
 * persisted on `AIGeneratedMessage.contextSnapshot`.
 *
 * Pure and deterministic: same input → byte-identical JSON. Missing optional
 * values (`creator.score`, `product.margin`, `trend.score`) become `null`;
 * a missing/`null` trend yields `trend: null`.
 */
export function serializeContext(input: PersonalizationContextInput): ContextSnapshot {
  const { creator, product, campaign, trend } = input;

  return {
    creator: {
      id: creator.id,
      name: creator.displayName,
      handle: creator.handle,
      niche: creator.niche,
      score: creator.score ?? null,
    },
    product: {
      id: product.id,
      name: product.name,
      margin: product.margin ?? null,
    },
    campaign: {
      id: campaign.id,
      name: campaign.name,
    },
    trend: trend
      ? {
          keyword: trend.keyword,
          score: trend.score ?? null,
        }
      : null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableNumber(value: unknown): value is number | null {
  return typeof value === "number" || value === null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * PR007.1 — read a persisted `contextSnapshot` (unknown JSON coming back
 * from the database) with a structural guard. Returns `null` when the value
 * is missing (pre-PR007.1 rows) or does not match the frozen snapshot
 * shape, so audit consumers never crash on corrupted/legacy payloads.
 */
export function readContextSnapshot(value: unknown): ContextSnapshot | null {
  if (!isRecord(value)) return null;
  const { creator, product, campaign, trend } = value;
  if (
    !isRecord(creator) ||
    !isString(creator.id) ||
    !isString(creator.name) ||
    !isString(creator.handle) ||
    !isString(creator.niche) ||
    !isNullableNumber(creator.score)
  ) {
    return null;
  }
  if (
    !isRecord(product) ||
    !isString(product.id) ||
    !isString(product.name) ||
    !isNullableNumber(product.margin)
  ) {
    return null;
  }
  if (!isRecord(campaign) || !isString(campaign.id) || !isString(campaign.name)) {
    return null;
  }
  if (
    trend !== null &&
    (!isRecord(trend) || !isString(trend.keyword) || !isNullableNumber(trend.score))
  ) {
    return null;
  }
  return value as unknown as ContextSnapshot;
}

/**
 * Deterministic, order-independent serialization of a context object plus
 * the prompt version, used as the input to the cache-key hash
 * (see `modules/ai/personalization/message.service.ts#buildContextHash`).
 *
 * NOTE (PR007.1): this is the ONLY serializer allowed to feed the cache
 * hash. The audit serializer above (`serializeContext`) intentionally has a
 * different shape and must never be hashed.
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
