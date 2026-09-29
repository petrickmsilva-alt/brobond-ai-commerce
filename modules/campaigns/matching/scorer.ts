/**
 * Confidence Score — the normalization layer of the Product Matching
 * Engine (PR005.1).
 *
 * Pure, dependency-free arithmetic so it stays unit-testable and usable
 * from any runtime. The matcher accumulates rule points (0–100) and this
 * module converts them into the persisted `ProductMatch.confidence`
 * float, normalized to the 0.00–1.00 range.
 *
 * Hard contract: the result is NEVER above 1 and never below 0, no matter
 * what the caller feeds in (negative points, NaN, Infinity, a zero or
 * negative maximum — all collapse safely).
 */

/** Points awarded when a product keyword appears in the content title. */
export const MATCH_KEYWORD_TITLE_POINTS = 40;

/** Points awarded when the content and product categories coincide. */
export const MATCH_CATEGORY_POINTS = 25;

/** Points awarded when the product slug appears in the content text. */
export const MATCH_SLUG_POINTS = 20;

/** Points awarded when a keyword partially matches a content word. */
export const MATCH_PARTIAL_WORD_POINTS = 15;

/** The four rule weights, single source of truth for matcher + docs. */
export const MATCH_RULE_WEIGHTS = {
  keywordInTitle: MATCH_KEYWORD_TITLE_POINTS,
  category: MATCH_CATEGORY_POINTS,
  slug: MATCH_SLUG_POINTS,
  partialWord: MATCH_PARTIAL_WORD_POINTS,
} as const;

/** Maximum reachable score — the sum of the four rule weights (100). */
export const MATCH_MAX_POINTS: number =
  MATCH_KEYWORD_TITLE_POINTS +
  MATCH_CATEGORY_POINTS +
  MATCH_SLUG_POINTS +
  MATCH_PARTIAL_WORD_POINTS;

/**
 * Convert accumulated rule points into a confidence float.
 *
 * ```ts
 * calculateMatchConfidence(98)  // 0.98
 * calculateMatchConfidence(76)  // 0.76
 * calculateMatchConfidence(52)  // 0.52
 * calculateMatchConfidence(140) // 1    — clamped, never above 1
 * calculateMatchConfidence(-3)  // 0    — clamped
 * ```
 *
 * The result is rounded to two decimal places so the persisted float is
 * stable across engines/serializations (0.555 → 0.56, never 0.55499999…).
 *
 * @param points    accumulated rule points (typically 0–100).
 * @param maxPoints the points that map to full confidence (default 100).
 * @returns a float in [0, 1] rounded to 2 decimals.
 */
export function calculateMatchConfidence(
  points: number,
  maxPoints: number = MATCH_MAX_POINTS,
): number {
  // Hostile/garbage input collapses to 0 — the engine never throws on score.
  if (!Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(points, 0), maxPoints);
  return Math.round((clamped / maxPoints) * 100) / 100;
}

// ------------------------------------------------------------------
// PR006 — creator/product campaign score
// ------------------------------------------------------------------

export const CAMPAIGN_MATCH_WEIGHTS = {
  trendScore: 0.3,
  creatorScore: 0.3,
  margin: 0.2,
  nicheMatch: 0.2,
} as const;

export interface MatchScoreInput {
  trendScore: number;
  creatorScore: number;
  /** Product gross margin as a normalized 0–100 percentage. */
  margin: number;
  /** Boolean shorthand or a normalized 0–100 affinity. */
  nicheMatch: boolean | number;
}

function scoreComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Deterministic campaign affinity in [0, 100].
 * Trend 30% · creator quality 30% · gross margin 20% · niche affinity 20%.
 */
export function calculateMatchScore(input: MatchScoreInput): number {
  const niche =
    typeof input.nicheMatch === "boolean" ? (input.nicheMatch ? 100 : 0) : input.nicheMatch;
  const score =
    scoreComponent(input.trendScore) * CAMPAIGN_MATCH_WEIGHTS.trendScore +
    scoreComponent(input.creatorScore) * CAMPAIGN_MATCH_WEIGHTS.creatorScore +
    scoreComponent(input.margin) * CAMPAIGN_MATCH_WEIGHTS.margin +
    scoreComponent(niche) * CAMPAIGN_MATCH_WEIGHTS.nicheMatch;
  return Math.round(score);
}
