import { describe, expect, it } from "vitest";
import {
  LIKES_NORMALIZATION_CEILING,
  SHARES_NORMALIZATION_CEILING,
  TREND_SCORE_WEIGHTS,
  VIEWS_NORMALIZATION_CEILING,
  calculateTrendScore,
  lowSaturationScore,
  normalizeAgainstCeiling,
  normalizeLikes,
  normalizeMargin,
  normalizeShares,
  normalizeViews,
  scoreTrend,
} from "@/modules/trends/hunter/scorer";

/**
 * PR002 — Trend Score Engine.
 *
 * Contract under test:
 * - every component is normalized to 0–100 before weighting;
 * - weights: views 30% · likes 20% · shares 15% · margin 20% · low saturation 15%;
 * - the result is an integer in [0, 100];
 * - malformed input throws instead of being silently scored.
 */

const PERFECT = {
  views: VIEWS_NORMALIZATION_CEILING,
  likes: LIKES_NORMALIZATION_CEILING,
  shares: SHARES_NORMALIZATION_CEILING,
  margin: 100,
  saturation: 0,
};

const ZERO = { views: 0, likes: 0, shares: 0, margin: 0, saturation: 100 };

describe("weights", () => {
  it("sum to exactly 1 (100%)", () => {
    const sum =
      TREND_SCORE_WEIGHTS.views +
      TREND_SCORE_WEIGHTS.likes +
      TREND_SCORE_WEIGHTS.shares +
      TREND_SCORE_WEIGHTS.margin +
      TREND_SCORE_WEIGHTS.lowSaturation;
    expect(sum).toBe(1);
  });

  it("match the PR002 specification", () => {
    expect(TREND_SCORE_WEIGHTS.views).toBe(0.3);
    expect(TREND_SCORE_WEIGHTS.likes).toBe(0.2);
    expect(TREND_SCORE_WEIGHTS.shares).toBe(0.15);
    expect(TREND_SCORE_WEIGHTS.margin).toBe(0.2);
    expect(TREND_SCORE_WEIGHTS.lowSaturation).toBe(0.15);
  });
});

describe("normalizeAgainstCeiling", () => {
  it("maps 0 to 0", () => {
    expect(normalizeAgainstCeiling(0, 1000)).toBe(0);
  });

  it("maps exactly the ceiling to 100", () => {
    expect(normalizeAgainstCeiling(1000, 1000)).toBe(100);
  });

  it("is linear below the ceiling", () => {
    expect(normalizeAgainstCeiling(500, 1000)).toBe(50);
    expect(normalizeAgainstCeiling(250, 1000)).toBe(25);
  });

  it("clamps values above the ceiling to 100", () => {
    expect(normalizeAgainstCeiling(100_000, 1000)).toBe(100);
  });

  it("rejects a non-positive ceiling", () => {
    expect(() => normalizeAgainstCeiling(10, 0)).toThrow(RangeError);
    expect(() => normalizeAgainstCeiling(10, -5)).toThrow(RangeError);
  });

  it("rejects negative and non-integer counts", () => {
    expect(() => normalizeAgainstCeiling(-1, 1000)).toThrow(RangeError);
    expect(() => normalizeAgainstCeiling(10.5, 1000)).toThrow(RangeError);
  });
});

describe("component normalizers", () => {
  it("normalizeViews uses the views ceiling", () => {
    expect(normalizeViews(VIEWS_NORMALIZATION_CEILING)).toBe(100);
    expect(normalizeViews(VIEWS_NORMALIZATION_CEILING / 2)).toBe(50);
    expect(normalizeViews(VIEWS_NORMALIZATION_CEILING * 10)).toBe(100);
  });

  it("normalizeLikes uses the likes ceiling", () => {
    expect(normalizeLikes(LIKES_NORMALIZATION_CEILING)).toBe(100);
    expect(normalizeLikes(LIKES_NORMALIZATION_CEILING / 4)).toBe(25);
  });

  it("normalizeShares uses the shares ceiling", () => {
    expect(normalizeShares(SHARES_NORMALIZATION_CEILING)).toBe(100);
    expect(normalizeShares(SHARES_NORMALIZATION_CEILING / 2)).toBe(50);
  });

  it("normalizeMargin clamps percent into 0–100", () => {
    expect(normalizeMargin(0)).toBe(0);
    expect(normalizeMargin(55.5)).toBe(55.5);
    expect(normalizeMargin(100)).toBe(100);
    expect(normalizeMargin(150)).toBe(100);
    expect(normalizeMargin(-10)).toBe(0);
  });

  it("lowSaturationScore inverts saturation (blue ocean scores higher)", () => {
    expect(lowSaturationScore(0)).toBe(100);
    expect(lowSaturationScore(30)).toBe(70);
    expect(lowSaturationScore(100)).toBe(0);
    expect(lowSaturationScore(120)).toBe(0); // clamped
    expect(lowSaturationScore(-20)).toBe(100); // clamped
  });
});

describe("calculateTrendScore", () => {
  it("returns 100 for a perfect signal", () => {
    expect(calculateTrendScore(PERFECT)).toBe(100);
  });

  it("returns 0 for a zero signal", () => {
    expect(calculateTrendScore(ZERO)).toBe(0);
  });

  it("isolated views contribute exactly their 30% weight", () => {
    const score = calculateTrendScore({ ...ZERO, views: VIEWS_NORMALIZATION_CEILING });
    expect(score).toBe(30);
  });

  it("isolated likes contribute exactly their 20% weight", () => {
    const score = calculateTrendScore({ ...ZERO, likes: LIKES_NORMALIZATION_CEILING });
    expect(score).toBe(20);
  });

  it("isolated shares contribute exactly their 15% weight", () => {
    const score = calculateTrendScore({ ...ZERO, shares: SHARES_NORMALIZATION_CEILING });
    expect(score).toBe(15);
  });

  it("isolated margin contributes exactly its 20% weight", () => {
    const score = calculateTrendScore({ ...ZERO, margin: 100 });
    expect(score).toBe(20);
  });

  it("isolated low saturation contributes exactly its 15% weight", () => {
    const score = calculateTrendScore({ ...ZERO, saturation: 0 });
    expect(score).toBe(15);
  });

  it("computes a known mid-range value", () => {
    // views 50 → 15 · likes 40 → 8 · shares 60 → 9 · margin 50 → 10 · lowSat 60 → 9
    const score = calculateTrendScore({
      views: VIEWS_NORMALIZATION_CEILING / 2,
      likes: LIKES_NORMALIZATION_CEILING * 0.4,
      shares: SHARES_NORMALIZATION_CEILING * 0.6,
      margin: 50,
      saturation: 40,
    });
    expect(score).toBe(51);
  });

  it("rounds to an integer (never floors drift)", () => {
    const score = calculateTrendScore({
      views: 0,
      likes: 0,
      shares: 0,
      margin: 33.34, // 33.34 * 0.2 = 6.668
      saturation: 55.55, // 44.45 * 0.15 = 6.6675
    });
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBe(13); // round(13.3355)
  });

  it("always stays within 0–100 across a value grid", () => {
    const steps = [0, 0.25, 0.5, 0.75, 1, 1.5, 3];
    for (const v of steps) {
      for (const l of steps) {
        for (const s of steps) {
          for (const m of [-10, 0, 25, 60, 100, 130]) {
            for (const sat of [-5, 10, 45, 80, 105]) {
              const score = calculateTrendScore({
                views: Math.round(v * VIEWS_NORMALIZATION_CEILING),
                likes: Math.round(l * LIKES_NORMALIZATION_CEILING),
                shares: Math.round(s * SHARES_NORMALIZATION_CEILING),
                margin: m,
                saturation: sat,
              });
              expect(score).toBeGreaterThanOrEqual(0);
              expect(score).toBeLessThanOrEqual(100);
            }
          }
        }
      }
    }
  });

  it("engagement above every ceiling still caps at the weighted maximum", () => {
    const score = calculateTrendScore({
      views: 100_000_000,
      likes: 100_000_000,
      shares: 100_000_000,
      margin: 100,
      saturation: 0,
    });
    expect(score).toBe(100);
  });
});

describe("input guards", () => {
  it("rejects negative engagement counts", () => {
    expect(() => calculateTrendScore({ ...PERFECT, views: -1 })).toThrow(RangeError);
    expect(() => calculateTrendScore({ ...PERFECT, likes: -10 })).toThrow(RangeError);
    expect(() => calculateTrendScore({ ...PERFECT, shares: -3 })).toThrow(RangeError);
  });

  it("rejects non-integer engagement counts", () => {
    expect(() => calculateTrendScore({ ...PERFECT, views: 10.5 })).toThrow(RangeError);
    expect(() => calculateTrendScore({ ...PERFECT, shares: 3.14 })).toThrow(RangeError);
  });

  it("rejects NaN and Infinity anywhere", () => {
    expect(() => calculateTrendScore({ ...PERFECT, views: Number.NaN })).toThrow(RangeError);
    expect(() => calculateTrendScore({ ...PERFECT, margin: Number.POSITIVE_INFINITY })).toThrow(
      RangeError,
    );
    expect(() => calculateTrendScore({ ...PERFECT, saturation: Number.NaN })).toThrow(RangeError);
  });
});

describe("scoreTrend", () => {
  it("enriches a signal with its score", () => {
    const scored = scoreTrend({
      keyword: "camisa masculina",
      category: "Moda",
      views: 1_850_000,
      likes: 320_000,
      shares: 48_000,
      margin: 62,
      saturation: 22,
    });
    expect(scored.trendScore).toBe(calculateTrendScore(scored));
    expect(scored.keyword).toBe("camisa masculina");
    expect(scored.category).toBe("Moda");
  });

  it("does not mutate the input signal", () => {
    const signal = {
      keyword: "polo slim",
      category: "Casual" as const,
      views: 980_000,
      likes: 196_000,
      shares: 27_500,
      margin: 60,
      saturation: 25,
    };
    const copy = { ...signal };
    scoreTrend(signal);
    expect(signal).toEqual(copy);
  });
});
