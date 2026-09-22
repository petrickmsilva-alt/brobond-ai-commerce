/**
 * Creator Score Engine — pure scoring math (no Prisma, no session, no I/O).
 *
 * `calculateCreatorScore()` turns a raw creator signal into a single 0–100
 * integer that the CRM can sort and filter on. Every component is first
 * normalized to a 0–100 scale, then weighted:
 *
 * | Component      | Weight | Normalization                                  |
 * | -------------- | -----: | ---------------------------------------------- |
 * | Engagement     |   30%  | engagement rate vs `ENGAGEMENT_RATE_CEILING`   |
 * | Frequency      |   25%  | posts/week vs `POSTS_PER_WEEK_CEILING`         |
 * | Niche match    |   20%  | percent, exact niche hit = 100                 |
 * | Growth         |   15%  | 30-day growth vs `GROWTH_RATE_CEILING`         |
 * | Quality        |   10%  | percent, clamped to 0–100                      |
 *
 * CONVENTIONS
 * -----------
 * - `engagementRate`, `growthRate` and `qualityScore` are percents on the
 *   0–100 scale; `postsPerWeek` may be fractional. Values above a ceiling
 *   are clamped (a future real source may report 300% monthly growth).
 * - The result is always an integer in [0, 100].
 */

import type {
  CreatorCandidate,
  CreatorNicheName,
  CreatorScoreInput,
  ScoredCreator,
} from "../interfaces/creator.interface";
import { DEFAULT_TARGET_NICHES } from "../interfaces/creator.interface";

/** Weights — must sum to exactly 1. Asserted by the test suite. */
export const CREATOR_SCORE_WEIGHTS = {
  engagement: 0.3,
  frequency: 0.25,
  nicheMatch: 0.2,
  growth: 0.15,
  quality: 0.1,
} as const;

/**
 * Normalization ceilings — the value at which a component reaches the full
 * 100 points of its scale (values above it are clamped). Calibrated for
 * short-video fashion commerce: a 15% engagement rate, a post per day or a
 * 20% monthly follower growth are all exceptional.
 */
export const ENGAGEMENT_RATE_CEILING = 15;
export const POSTS_PER_WEEK_CEILING = 7;
export const GROWTH_RATE_CEILING = 20;

/**
 * A creator is "premium" from this score upwards (KPI + filters).
 * 80 keeps the tier selective: roughly the top quintile of a healthy base.
 */
export const PREMIUM_CREATOR_SCORE_THRESHOLD = 80;

/** Clamp a number into the inclusive [0, 100] range. */
function clampTo100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/** Assert a finite number (NaN/Infinity are rejected, never silently scored). */
function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number (got ${value}).`);
  }
}

/** Assert a non-negative number (percents and frequencies may be fractional). */
function assertNonNegative(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative (got ${value}).`);
  }
}

/** Engagement rate (percent) → 0–100, linear against the ceiling, clamped. */
export function normalizeEngagementRate(engagementRate: number): number {
  assertNonNegative(engagementRate, "engagementRate");
  return clampTo100((engagementRate / ENGAGEMENT_RATE_CEILING) * 100);
}

/** Publishing frequency (posts/week) → 0–100, linear against the ceiling. */
export function normalizeFrequency(postsPerWeek: number): number {
  assertNonNegative(postsPerWeek, "postsPerWeek");
  return clampTo100((postsPerWeek / POSTS_PER_WEEK_CEILING) * 100);
}

/** 30-day follower growth (percent) → 0–100, linear against the ceiling. */
export function normalizeGrowth(growthRate: number): number {
  assertNonNegative(growthRate, "growthRate");
  return clampTo100((growthRate / GROWTH_RATE_CEILING) * 100);
}

/** Quality score (percent) → clamped 0–100. */
export function normalizeQuality(qualityScore: number): number {
  assertNonNegative(qualityScore, "qualityScore");
  return clampTo100(qualityScore);
}

/**
 * Niche match (percent, 0–100): 100 when the creator's niche is one of the
 * targets, 0 otherwise. The niche vocabulary is a closed list, so the match
 * is exact — a "Moda" creator matches a Moda-targeting workspace fully and
 * a "Fitness" targeting not at all.
 */
export function calculateNicheMatch(
  niche: CreatorNicheName,
  targetNiches: readonly CreatorNicheName[] = DEFAULT_TARGET_NICHES,
): number {
  return targetNiches.includes(niche) ? 100 : 0;
}

/**
 * The weighted 0–100 creator score, rounded to an integer.
 *
 * ```ts
 * calculateCreatorScore({
 *   engagementRate: 15,   // → 100 → 30 pts
 *   postsPerWeek: 7,      // → 100 → 25 pts
 *   nicheMatch: 100,      // → 100 → 20 pts
 *   growthRate: 20,       // → 100 → 15 pts
 *   qualityScore: 100,    // → 100 → 10 pts
 * }) // => 100
 * ```
 *
 * @throws {RangeError} on NaN/Infinity or negative component values.
 */
export function calculateCreatorScore(input: CreatorScoreInput): number {
  const components = {
    engagement: normalizeEngagementRate(input.engagementRate),
    frequency: normalizeFrequency(input.postsPerWeek),
    nicheMatch: clampTo100(assertFinite(input.nicheMatch, "nicheMatch")),
    growth: normalizeGrowth(input.growthRate),
    quality: normalizeQuality(input.qualityScore),
  };

  const weighted =
    components.engagement * CREATOR_SCORE_WEIGHTS.engagement +
    components.frequency * CREATOR_SCORE_WEIGHTS.frequency +
    components.nicheMatch * CREATOR_SCORE_WEIGHTS.nicheMatch +
    components.growth * CREATOR_SCORE_WEIGHTS.growth +
    components.quality * CREATOR_SCORE_WEIGHTS.quality;

  return Math.round(clampTo100(weighted));
}

function assertFinite(value: number, label: string): number {
  assertFiniteNumber(value, label);
  return value;
}

/**
 * Enrich a raw candidate with its `creatorScore` (0–100). The niche is
 * matched against `targetNiches` (defaults to every tracked niche —
 * a workspace passes its own targets to bias the score).
 */
export function scoreCreator(
  candidate: CreatorCandidate,
  targetNiches: readonly CreatorNicheName[] = DEFAULT_TARGET_NICHES,
): ScoredCreator {
  return {
    ...candidate,
    creatorScore: calculateCreatorScore({
      engagementRate: candidate.engagementRate,
      postsPerWeek: candidate.postsPerWeek,
      nicheMatch: calculateNicheMatch(candidate.niche, targetNiches),
      growthRate: candidate.growthRate,
      qualityScore: candidate.qualityScore,
    }),
  };
}
