import { describe, expect, it } from "vitest";
import {
  CREATOR_SCORE_WEIGHTS,
  ENGAGEMENT_RATE_CEILING,
  GROWTH_RATE_CEILING,
  POSTS_PER_WEEK_CEILING,
  PREMIUM_CREATOR_SCORE_THRESHOLD,
  calculateCreatorScore,
  calculateNicheMatch,
  normalizeEngagementRate,
  normalizeFrequency,
  normalizeGrowth,
  normalizeQuality,
  scoreCreator,
} from "@/modules/creators/discovery/scorer";
import {
  CREATOR_NICHES,
  DEFAULT_TARGET_NICHES,
  type CreatorCandidate,
} from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 — Creator Score Engine.
 *
 * Pure math, no I/O: weights, normalizations, ceilings, clamping and the
 * exact weighted result. The weights MUST sum to exactly 1 (otherwise the
 * 0–100 contract silently breaks).
 */

const PERFECT_INPUT = {
  engagementRate: ENGAGEMENT_RATE_CEILING,
  postsPerWeek: POSTS_PER_WEEK_CEILING,
  nicheMatch: 100,
  growthRate: GROWTH_RATE_CEILING,
  qualityScore: 100,
};

describe("CREATOR_SCORE_WEIGHTS", () => {
  it("has the PR003 mandated weights (30/25/20/15/10)", () => {
    expect(CREATOR_SCORE_WEIGHTS).toEqual({
      engagement: 0.3,
      frequency: 0.25,
      nicheMatch: 0.2,
      growth: 0.15,
      quality: 0.1,
    });
  });

  it("sums to exactly 1", () => {
    const total = Object.values(CREATOR_SCORE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBe(1);
  });
});

describe("normalizeEngagementRate", () => {
  it("maps the ceiling to 100", () => {
    expect(normalizeEngagementRate(ENGAGEMENT_RATE_CEILING)).toBe(100);
  });

  it("is linear below the ceiling", () => {
    expect(normalizeEngagementRate(ENGAGEMENT_RATE_CEILING / 2)).toBe(50);
    expect(normalizeEngagementRate(0)).toBe(0);
  });

  it("clamps above the ceiling", () => {
    expect(normalizeEngagementRate(ENGAGEMENT_RATE_CEILING * 10)).toBe(100);
  });

  it("rejects negative, NaN and Infinity", () => {
    expect(() => normalizeEngagementRate(-1)).toThrowError(RangeError);
    expect(() => normalizeEngagementRate(Number.NaN)).toThrowError(RangeError);
    expect(() => normalizeEngagementRate(Number.POSITIVE_INFINITY)).toThrowError(RangeError);
  });
});

describe("normalizeFrequency", () => {
  it("maps the weekly ceiling to 100", () => {
    expect(normalizeFrequency(POSTS_PER_WEEK_CEILING)).toBe(100);
  });

  it("accepts fractional frequencies", () => {
    expect(normalizeFrequency(POSTS_PER_WEEK_CEILING / 4)).toBe(25);
  });

  it("clamps above the ceiling and rejects invalid values", () => {
    expect(normalizeFrequency(999)).toBe(100);
    expect(() => normalizeFrequency(-0.5)).toThrowError(RangeError);
    expect(() => normalizeFrequency(Number.NaN)).toThrowError(RangeError);
  });
});

describe("normalizeGrowth", () => {
  it("maps the monthly ceiling to 100", () => {
    expect(normalizeGrowth(GROWTH_RATE_CEILING)).toBe(100);
  });

  it("clamps viral growth and rejects invalid values", () => {
    expect(normalizeGrowth(500)).toBe(100);
    expect(() => normalizeGrowth(-3)).toThrowError(RangeError);
    expect(() => normalizeGrowth(Number.NEGATIVE_INFINITY)).toThrowError(RangeError);
  });
});

describe("normalizeQuality", () => {
  it("passes through values already on the 0–100 scale", () => {
    expect(normalizeQuality(0)).toBe(0);
    expect(normalizeQuality(72)).toBe(72);
    expect(normalizeQuality(100)).toBe(100);
  });

  it("clamps above 100 and rejects invalid values", () => {
    expect(normalizeQuality(101)).toBe(100);
    expect(() => normalizeQuality(-1)).toThrowError(RangeError);
    expect(() => normalizeQuality(Number.NaN)).toThrowError(RangeError);
  });
});

describe("calculateNicheMatch", () => {
  it("scores 100 for an exact niche hit", () => {
    expect(calculateNicheMatch("Moda", ["Moda", "Street"])).toBe(100);
  });

  it("scores 0 when the niche is not targeted", () => {
    expect(calculateNicheMatch("Fitness", ["Moda", "Street"])).toBe(0);
  });

  it("defaults to every tracked niche (fashion vertical)", () => {
    expect(DEFAULT_TARGET_NICHES).toEqual(CREATOR_NICHES);
    for (const niche of CREATOR_NICHES) {
      expect(calculateNicheMatch(niche)).toBe(100);
    }
  });

  it("handles an empty target list", () => {
    expect(calculateNicheMatch("Moda", [])).toBe(0);
  });
});

describe("calculateCreatorScore", () => {
  it("returns 100 for a perfect profile", () => {
    expect(calculateCreatorScore(PERFECT_INPUT)).toBe(100);
  });

  it("returns 0 for a zeroed profile", () => {
    expect(
      calculateCreatorScore({
        engagementRate: 0,
        postsPerWeek: 0,
        nicheMatch: 0,
        growthRate: 0,
        qualityScore: 0,
      }),
    ).toBe(0);
  });

  it("always returns an integer within 0–100", () => {
    const input = {
      engagementRate: 7.3,
      postsPerWeek: 3.7,
      nicheMatch: 100,
      growthRate: 11.9,
      qualityScore: 63,
    };
    const score = calculateCreatorScore(input);
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("applies each weight exactly", () => {
    // Every component at 50 except quality at 100:
    // 50*(0.3+0.25+0.2+0.15) + 100*0.1 = 45 + 10 = 55
    expect(
      calculateCreatorScore({
        engagementRate: ENGAGEMENT_RATE_CEILING / 2,
        postsPerWeek: POSTS_PER_WEEK_CEILING / 2,
        nicheMatch: 50,
        growthRate: GROWTH_RATE_CEILING / 2,
        qualityScore: 100,
      }),
    ).toBe(55);
  });

  it("rounds to the nearest integer", () => {
    // engagement 15/30 → 10 pts · frequency 0.35/7 → 1.25 pts · rest 0.
    expect(
      calculateCreatorScore({
        engagementRate: 5,
        postsPerWeek: 0.35,
        nicheMatch: 0,
        growthRate: 0,
        qualityScore: 0,
      }),
    ).toBe(11); // 11.25 → 11
  });

  it("is monotonic in engagement (higher rate never lowers the score)", () => {
    let previous = -1;
    for (let rate = 0; rate <= ENGAGEMENT_RATE_CEILING; rate += 1) {
      const score = calculateCreatorScore({
        engagementRate: rate,
        postsPerWeek: 3,
        nicheMatch: 100,
        growthRate: 5,
        qualityScore: 60,
      });
      expect(score).toBeGreaterThanOrEqual(previous);
      previous = score;
    }
  });

  it("clamps an all-overflow profile to 100", () => {
    expect(
      calculateCreatorScore({
        engagementRate: 100,
        postsPerWeek: 70,
        nicheMatch: 100,
        growthRate: 10_000,
        qualityScore: 100,
      }),
    ).toBe(100);
  });

  it("throws RangeError on NaN/Infinity components", () => {
    expect(() =>
      calculateCreatorScore({ ...PERFECT_INPUT, engagementRate: Number.NaN }),
    ).toThrowError(RangeError);
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, postsPerWeek: Infinity })).toThrowError(
      RangeError,
    );
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, nicheMatch: NaN })).toThrowError(
      RangeError,
    );
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, growthRate: NaN })).toThrowError(
      RangeError,
    );
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, qualityScore: NaN })).toThrowError(
      RangeError,
    );
  });

  it("throws RangeError on negative components", () => {
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, engagementRate: -0.1 })).toThrowError(
      RangeError,
    );
    expect(() => calculateCreatorScore({ ...PERFECT_INPUT, growthRate: -5 })).toThrowError(
      RangeError,
    );
  });
});

describe("scoreCreator", () => {
  const CANDIDATE: CreatorCandidate = {
    externalId: "mock-moda-001",
    handle: "@ana.souza001",
    displayName: "Ana Souza",
    niche: "Moda",
    followers: 250_000,
    avgViews: 90_000,
    engagementRate: 7.5,
    postsPerWeek: 4,
    growthRate: 10,
    qualityScore: 80,
    tags: ["moda masculina"],
  };

  it("enriches the candidate without mutating it", () => {
    const original = { ...CANDIDATE };
    const scored = scoreCreator(CANDIDATE);
    expect(scored).not.toBe(CANDIDATE);
    expect(scored.creatorScore).toBe(
      calculateCreatorScore({
        engagementRate: CANDIDATE.engagementRate,
        postsPerWeek: CANDIDATE.postsPerWeek,
        nicheMatch: 100,
        growthRate: CANDIDATE.growthRate,
        qualityScore: CANDIDATE.qualityScore,
      }),
    );
    expect(CANDIDATE).toEqual(original);
  });

  it("keeps every candidate field on the scored result", () => {
    const scored = scoreCreator(CANDIDATE);
    expect(scored.handle).toBe(CANDIDATE.handle);
    expect(scored.followers).toBe(CANDIDATE.followers);
    expect(scored.tags).toEqual(CANDIDATE.tags);
  });

  it("derives the niche match from the target niches", () => {
    const scored = scoreCreator({ ...CANDIDATE, niche: "Fitness" }, ["Fitness"]);
    const withoutMatch = scoreCreator({ ...CANDIDATE, niche: "Fitness" }, ["Moda"]);
    expect(scored.creatorScore).toBeGreaterThan(withoutMatch.creatorScore);
    expect(scored.creatorScore - withoutMatch.creatorScore).toBe(20); // full niche weight
  });

  it("produces a 0–100 integer", () => {
    for (const niche of CREATOR_NICHES) {
      const scored = scoreCreator({ ...CANDIDATE, niche });
      expect(Number.isInteger(scored.creatorScore)).toBe(true);
      expect(scored.creatorScore).toBeGreaterThanOrEqual(0);
      expect(scored.creatorScore).toBeLessThanOrEqual(100);
    }
  });
});

describe("PREMIUM_CREATOR_SCORE_THRESHOLD", () => {
  it("is 80 (selective top tier)", () => {
    expect(PREMIUM_CREATOR_SCORE_THRESHOLD).toBe(80);
  });
});
