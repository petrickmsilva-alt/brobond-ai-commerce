import { describe, expect, it } from "vitest";
import { estimateCostUsdCents, formatEstimatedCost } from "@/modules/ai/openai/pricing";

describe("estimateCostUsdCents()", () => {
  it("computes cost for a known model", () => {
    const cost = estimateCostUsdCents("gpt-4o-mini", 1000, 1000);
    expect(cost).toBeCloseTo(0.015 + 0.06, 6);
  });

  it("returns 0 for zero tokens", () => {
    expect(estimateCostUsdCents("gpt-4o-mini", 0, 0)).toBe(0);
  });

  it("scales linearly with token count", () => {
    const single = estimateCostUsdCents("gpt-4o-mini", 1000, 0);
    const double = estimateCostUsdCents("gpt-4o-mini", 2000, 0);
    expect(double).toBeCloseTo(single * 2, 6);
  });

  it("falls back to the default rate for an unknown model", () => {
    const known = estimateCostUsdCents("gpt-4o-mini", 1000, 1000);
    const unknown = estimateCostUsdCents("some-future-model", 1000, 1000);
    expect(unknown).toBeCloseTo(known, 6);
  });

  it("charges output tokens at a higher rate than input tokens for gpt-4o-mini", () => {
    const inputOnly = estimateCostUsdCents("gpt-4o-mini", 1000, 0);
    const outputOnly = estimateCostUsdCents("gpt-4o-mini", 0, 1000);
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });
});

describe("formatEstimatedCost()", () => {
  it("formats zero as a currency string", () => {
    expect(formatEstimatedCost(0)).toBe("$0.00");
  });

  it("formats a small fractional amount with enough precision to be non-zero", () => {
    const formatted = formatEstimatedCost(0.5);
    expect(formatted).not.toBe("$0.00");
    expect(formatted.startsWith("$")).toBe(true);
  });

  it("formats a whole dollar amount", () => {
    expect(formatEstimatedCost(100)).toBe("$1.00");
  });
});
