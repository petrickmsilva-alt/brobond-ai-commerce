/**
 * Trend Score Engine — pure scoring math (no Prisma, no session, no I/O).
 *
 * `calculateTrendScore()` turns a raw trend signal into a single 0–100
 * integer that the dashboard can sort and filter on. Every component is
 * first normalized to a 0–100 scale, then weighted:
 *
 * | Component      | Weight | Normalization                                    |
 * | -------------- | -----: | ------------------------------------------------ |
 * | Views          |   30%  | linear against `VIEWS_NORMALIZATION_CEILING`     |
 * | Likes          |   20%  | linear against `LIKES_NORMALIZATION_CEILING`     |
 * | Shares         |   15%  | linear against `SHARES_NORMALIZATION_CEILING`    |
 * | Margin         |   20%  | percent, clamped to 0–100                        |
 * | Low saturation |   15%  | `100 − saturation` (blue ocean scores higher)    |
 *
 * CONVENTIONS
 * -----------
 * - `views`/`likes`/`shares` are non-negative integers (counts).
 * - `margin` and `saturation` are percents in the 0–100 range and are
 *   clamped into it (a future real source may report 105% of a ceiling).
 * - The result is always an integer in [0, 100].
 */

import type { ScoredTrend, TrendSignal, TrendScoreInput } from "../interfaces/trend.interface";

/** Weights — must sum to exactly 1. Asserted by the test suite. */
export const TREND_SCORE_WEIGHTS = {
  views: 0.3,
  likes: 0.2,
  shares: 0.15,
  margin: 0.2,
  lowSaturation: 0.15,
} as const;

/**
 * Engagement ceilings — the value at which a component reaches the full
 * 100 points of its scale (values above it are clamped). Calibrated for
 * daily product-trend content on short-video platforms.
 */
export const VIEWS_NORMALIZATION_CEILING = 1_200_000;
export const LIKES_NORMALIZATION_CEILING = 250_000;
export const SHARES_NORMALIZATION_CEILING = 35_000;

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

/** Assert a non-negative integer count. */
function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer (got ${value}).`);
  }
}

/** Normalize an engagement count against a ceiling, linearly, to 0–100. */
export function normalizeAgainstCeiling(value: number, ceiling: number): number {
  assertNonNegativeInt(value, "value");
  assertFiniteNumber(ceiling, "ceiling");
  if (ceiling <= 0) {
    throw new RangeError(`ceiling must be positive (got ${ceiling}).`);
  }
  return clampTo100((value / ceiling) * 100);
}

/** Views → 0–100 (linear against `VIEWS_NORMALIZATION_CEILING`, clamped). */
export function normalizeViews(views: number): number {
  return normalizeAgainstCeiling(views, VIEWS_NORMALIZATION_CEILING);
}

/** Likes → 0–100 (linear against `LIKES_NORMALIZATION_CEILING`, clamped). */
export function normalizeLikes(likes: number): number {
  return normalizeAgainstCeiling(likes, LIKES_NORMALIZATION_CEILING);
}

/** Shares → 0–100 (linear against `SHARES_NORMALIZATION_CEILING`, clamped). */
export function normalizeShares(shares: number): number {
  return normalizeAgainstCeiling(shares, SHARES_NORMALIZATION_CEILING);
}

/** Margin (percent) → clamped 0–100. */
export function normalizeMargin(margin: number): number {
  assertFiniteNumber(margin, "margin");
  return clampTo100(margin);
}

/** Saturation (percent 0–100) → "low saturation" score: 100 − saturation. */
export function lowSaturationScore(saturation: number): number {
  assertFiniteNumber(saturation, "saturation");
  return 100 - clampTo100(saturation);
}

/**
 * The weighted 0–100 trend score of a raw signal, rounded to an integer.
 *
 * ```ts
 * calculateTrendScore({
 *   views: 1_200_000, // → 100 → 30 pts
 *   likes: 250_000,   // → 100 → 20 pts
 *   shares: 35_000,   // → 100 → 15 pts
 *   margin: 100,      // → 100 → 20 pts
 *   saturation: 0,    // → 100 → 15 pts
 * }) // => 100
 * ```
 *
 * @throws {RangeError} on NaN/Infinity or non-integer engagement counts.
 */
export function calculateTrendScore(input: TrendScoreInput): number {
  const components = {
    views: normalizeViews(input.views),
    likes: normalizeLikes(input.likes),
    shares: normalizeShares(input.shares),
    margin: normalizeMargin(input.margin),
    lowSaturation: lowSaturationScore(input.saturation),
  };

  const weighted =
    components.views * TREND_SCORE_WEIGHTS.views +
    components.likes * TREND_SCORE_WEIGHTS.likes +
    components.shares * TREND_SCORE_WEIGHTS.shares +
    components.margin * TREND_SCORE_WEIGHTS.margin +
    components.lowSaturation * TREND_SCORE_WEIGHTS.lowSaturation;

  return Math.round(clampTo100(weighted));
}

/** Enrich a raw signal with its `trendScore`. */
export function scoreTrend(signal: TrendSignal): ScoredTrend {
  return { ...signal, trendScore: calculateTrendScore(signal) };
}
