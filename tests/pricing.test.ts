import { describe, expect, it } from "vitest";
import {
  BPS_IN_100_PERCENT,
  bpsToPercent,
  formatMarginBps,
  marginBps,
  profitCents,
  totalCostCents,
} from "@/modules/commerce/products/pricing/margin";

describe("pricing/margin — totalCostCents", () => {
  it("sums every cost component", () => {
    expect(
      totalCostCents({
        unitCents: 2500,
        freightCents: 300,
        packagingCents: 200,
        feesCents: 150,
        otherCents: 50,
      }),
    ).toBe(3200);
  });

  it("treats missing components as zero", () => {
    expect(totalCostCents({ unitCents: 1000 })).toBe(1000);
  });

  it("rejects negative values", () => {
    expect(() => totalCostCents({ unitCents: -1 })).toThrow(RangeError);
    expect(() => totalCostCents({ unitCents: 100, freightCents: -5 })).toThrow(RangeError);
  });

  it("rejects non-integer cents", () => {
    expect(() => totalCostCents({ unitCents: 10.5 })).toThrow(RangeError);
  });
});

describe("pricing/margin — profitCents", () => {
  it("computes absolute profit", () => {
    expect(profitCents(6900, 3000)).toBe(3900);
  });

  it("is negative when selling below cost", () => {
    expect(profitCents(1000, 1500)).toBe(-500);
  });
});

describe("pricing/margin — marginBps", () => {
  it("computes gross margin in basis points", () => {
    // (6900 - 3000) / 6900 = 56.52…% → 5652 bps
    expect(marginBps(6900, 3000)).toBe(5652);
  });

  it("returns 10000 bps (100%) when cost is zero", () => {
    expect(marginBps(5000, 0)).toBe(BPS_IN_100_PERCENT);
  });

  it("returns 0 for a zero price instead of NaN/Infinity", () => {
    expect(marginBps(0, 1000)).toBe(0);
    expect(marginBps(0, 0)).toBe(0);
  });

  it("is negative when selling below cost", () => {
    expect(marginBps(1000, 1500)).toBe(-5000);
  });

  it("rounds to the nearest basis point", () => {
    // (149.90 - 100.00) / 149.90 = 33.289…% → 3329 bps
    expect(marginBps(14990, 10000)).toBe(3329);
  });

  it("rejects negative inputs", () => {
    expect(() => marginBps(-1, 0)).toThrow(RangeError);
    expect(() => marginBps(100, -1)).toThrow(RangeError);
  });
});

describe("pricing/margin — display helpers", () => {
  it("converts bps to percent", () => {
    expect(bpsToPercent(3550)).toBe(35.5);
  });

  it("formats bps pt-BR style", () => {
    expect(formatMarginBps(3550)).toBe("35,50%");
    expect(formatMarginBps(-5000)).toBe("-50,00%");
  });
});
