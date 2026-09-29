import { describe, expect, it } from "vitest";
import {
  calculatePriority,
  calculatePriorityBreakdown,
  scorePotentialRevenue,
  scoreRoi,
} from "@/modules/ai-ceo/engine/priority.engine";

const roiCases: Array<[number, number]> = [
  [-10_000, 100],
  [-1, 100],
  [0, 85],
  [2_499, 85],
  [2_500, 65],
  [4_999, 65],
  [5_000, 45],
  [9_999, 45],
  [10_000, 25],
  [100_000, 25],
  [Number.NaN, 0],
];

const revenueCases: Array<[number, number]> = [
  [-1, 0],
  [0, 0],
  [1, 25],
  [99_999, 25],
  [100_000, 45],
  [499_999, 45],
  [500_000, 65],
  [1_999_999, 65],
  [2_000_000, 85],
  [4_999_999, 85],
  [5_000_000, 100],
  [Number.POSITIVE_INFINITY, 0],
];

describe("AI CEO priority engine — PR011", () => {
  it.each(roiCases)("scores ROI %s as %s", (input, expected) => {
    expect(scoreRoi(input)).toBe(expected);
  });

  it.each(revenueCases)("scores potential revenue %s as %s", (input, expected) => {
    expect(scorePotentialRevenue(input)).toBe(expected);
  });

  it("returns CRITICAL for a loss with large upside and immediate urgency", () => {
    expect(
      calculatePriority({
        roiBps: -1,
        potentialRevenueCents: 5_000_000,
        urgency: 100,
        trendScore: 100,
      }),
    ).toBe("CRITICAL");
  });

  it("returns LOW for healthy ROI and no upside/urgency/trend", () => {
    expect(
      calculatePriority({
        roiBps: 10_000,
        potentialRevenueCents: 0,
        urgency: 0,
        trendScore: 0,
      }),
    ).toBe("LOW");
  });

  it("uses the documented 30/35/20/15 weights", () => {
    const result = calculatePriorityBreakdown({
      roiBps: -1,
      potentialRevenueCents: 5_000_000,
      urgency: 50,
      trendScore: 50,
    });
    expect(result).toMatchObject({ roi: 100, revenue: 100, urgency: 50, trend: 50, score: 83 });
  });

  it("clamps normalized urgency and trend inputs", () => {
    const result = calculatePriorityBreakdown({
      roiBps: 10_000,
      potentialRevenueCents: 0,
      urgency: 999,
      trendScore: -50,
    });
    expect(result.urgency).toBe(100);
    expect(result.trend).toBe(0);
  });

  it("is deterministic across repeated calls", () => {
    const input = { roiBps: 1_500, potentialRevenueCents: 750_000, urgency: 64, trendScore: 88 };
    expect(calculatePriorityBreakdown(input)).toEqual(calculatePriorityBreakdown(input));
  });
});
