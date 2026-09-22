import { describe, expect, it } from "vitest";
import { CAMPAIGN_MATCH_WEIGHTS, calculateMatchScore } from "@/modules/campaigns/matching/scorer";

describe("PR006 campaign match scorer", () => {
  it("uses the mandated 30/30/20/20 weights", () => {
    expect(CAMPAIGN_MATCH_WEIGHTS).toEqual({
      trendScore: 0.3,
      creatorScore: 0.3,
      margin: 0.2,
      nicheMatch: 0.2,
    });
  });
  it("returns a rounded integer from zero to one hundred", () => {
    expect(
      calculateMatchScore({ trendScore: 81, creatorScore: 74, margin: 42, nicheMatch: true }),
    ).toBe(75);
    expect(
      calculateMatchScore({ trendScore: 0, creatorScore: 0, margin: 0, nicheMatch: false }),
    ).toBe(0);
    expect(
      calculateMatchScore({ trendScore: 100, creatorScore: 100, margin: 100, nicheMatch: true }),
    ).toBe(100);
  });
  it("clamps hostile inputs", () => {
    expect(
      calculateMatchScore({ trendScore: 999, creatorScore: -1, margin: Infinity, nicheMatch: 999 }),
    ).toBe(50);
    expect(
      calculateMatchScore({ trendScore: NaN, creatorScore: NaN, margin: NaN, nicheMatch: NaN }),
    ).toBe(0);
  });

  // Exhaustive integer contract: each input point is independently stable.
  it.each(Array.from({ length: 101 }, (_, value) => value))(
    "scores trend boundary %i deterministically",
    (value) => {
      const input = { trendScore: value, creatorScore: 50, margin: 50, nicheMatch: false };
      const first = calculateMatchScore(input);
      expect(first).toBe(calculateMatchScore(input));
      expect(Number.isInteger(first)).toBe(true);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThanOrEqual(100);
    },
  );
});
