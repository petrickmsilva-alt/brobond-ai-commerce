import { describe, expect, it } from "vitest";
import { estimateROI } from "@/modules/campaigns/roi/roi";

describe("estimateROI", () => {
  it("returns revenue, gross margin, commission, freight, profit and ROI", () => {
    expect(
      estimateROI({
        predictedRevenueCents: 100_000,
        marginPercent: 50,
        commissionPercent: 10,
        freightCents: 5_000,
      }),
    ).toEqual({
      predictedRevenueCents: 100_000,
      grossMarginCents: 50_000,
      commissionCents: 10_000,
      freightCents: 5_000,
      predictedProfitCents: 35_000,
      roiPercent: 233.33,
    });
  });
  it("supports a negative projected return", () => {
    expect(
      estimateROI({
        predictedRevenueCents: 10_000,
        marginPercent: 10,
        commissionPercent: 20,
        freightCents: 1_000,
      }).roiPercent,
    ).toBe(-66.67);
  });
  it("never propagates NaN, Infinity or negative costs", () => {
    expect(
      estimateROI({
        predictedRevenueCents: NaN,
        marginPercent: Infinity,
        commissionPercent: -10,
        freightCents: -1,
      }),
    ).toEqual({
      predictedRevenueCents: 0,
      grossMarginCents: 0,
      commissionCents: 0,
      freightCents: 0,
      predictedProfitCents: 0,
      roiPercent: 0,
    });
  });
  it("is deterministic and keeps money in integer cents", () => {
    const input = {
      predictedRevenueCents: 12_345,
      marginPercent: 33.3,
      commissionPercent: 7.5,
      freightCents: 499,
    };
    const result = estimateROI(input);
    expect(result).toEqual(estimateROI(input));
    expect(Number.isInteger(result.grossMarginCents)).toBe(true);
    expect(Number.isInteger(result.commissionCents)).toBe(true);
  });
});
