import { describe, expect, it } from "vitest";
import { computeSalesTotals, ratioBps } from "@/modules/analytics/metrics/sales-metrics";

describe("ratioBps()", () => {
  it("computes integer basis points rounded to nearest", () => {
    expect(ratioBps(1, 3)).toBe(3333);
    expect(ratioBps(1, 2)).toBe(5000);
    expect(ratioBps(100, 100)).toBe(10_000);
  });

  it("returns 0 when the whole is zero or negative", () => {
    expect(ratioBps(10, 0)).toBe(0);
    expect(ratioBps(10, -5)).toBe(0);
  });

  it("returns 0 when the part is zero", () => {
    expect(ratioBps(0, 100)).toBe(0);
  });
});

describe("computeSalesTotals() — PR008", () => {
  it("sums only PAID sales as revenue", () => {
    const totals = computeSalesTotals([
      { quantity: 1, amountCents: 10_000, status: "PAID", unitCostCents: 4000 },
      { quantity: 2, amountCents: 5000, status: "PENDING" },
      { quantity: 1, amountCents: 7000, status: "REFUNDED" },
      { quantity: 1, amountCents: 9000, status: "CANCELLED" },
    ]);
    expect(totals.revenueCents).toBe(10_000);
    expect(totals.paidCount).toBe(1);
    expect(totals.pendingCount).toBe(1);
    expect(totals.refundedCount).toBe(1);
    expect(totals.refundedCents).toBe(7000);
    expect(totals.cancelledCount).toBe(1);
  });

  it("computes units sold over PAID sales only", () => {
    const totals = computeSalesTotals([
      { quantity: 3, amountCents: 30_000, status: "PAID", unitCostCents: 5000 },
      { quantity: 10, amountCents: 100, status: "PAID", unitCostCents: 50 },
      { quantity: 99, amountCents: 100, status: "PENDING" },
    ]);
    expect(totals.unitsSold).toBe(13);
  });

  it("computes COGS as unitCostCents × quantity over PAID sales", () => {
    const totals = computeSalesTotals([
      { quantity: 3, amountCents: 30_000, status: "PAID", unitCostCents: 5000 },
      { quantity: 1, amountCents: 10_000, status: "PAID", unitCostCents: 9000 },
    ]);
    expect(totals.costCents).toBe(3 * 5000 + 9000);
    expect(totals.grossMarginCents).toBe(40_000 - 24_000);
  });

  it("computes gross margin bps over revenue", () => {
    const totals = computeSalesTotals([
      { quantity: 1, amountCents: 10_000, status: "PAID", unitCostCents: 6450 },
    ]);
    expect(totals.grossMarginCents).toBe(3550);
    expect(totals.grossMarginBps).toBe(3550);
  });

  it("treats unknown unit cost as 0 and flags the revenue", () => {
    const totals = computeSalesTotals([
      { quantity: 2, amountCents: 10_000, status: "PAID", unitCostCents: null },
      { quantity: 1, amountCents: 5000, status: "PAID", unitCostCents: 2000 },
    ]);
    expect(totals.costCents).toBe(2000);
    expect(totals.revenueWithUnknownCostCents).toBe(10_000);
    expect(totals.grossMarginCents).toBe(13_000);
  });

  it("defaults a missing unitCostCents field to unknown", () => {
    const totals = computeSalesTotals([{ quantity: 1, amountCents: 100, status: "PAID" }]);
    expect(totals.revenueWithUnknownCostCents).toBe(100);
    expect(totals.costCents).toBe(0);
  });

  it("computes the average ticket over PAID sales, rounded", () => {
    const totals = computeSalesTotals([
      { quantity: 1, amountCents: 10_001, status: "PAID", unitCostCents: 0 },
      { quantity: 1, amountCents: 10_000, status: "PAID", unitCostCents: 0 },
      { quantity: 1, amountCents: 10_002, status: "PAID", unitCostCents: 0 },
    ]);
    expect(totals.avgTicketCents).toBe(10_001);
  });

  it("returns a fully zeroed totals object for an empty list", () => {
    expect(computeSalesTotals([])).toEqual({
      revenueCents: 0,
      unitsSold: 0,
      paidCount: 0,
      pendingCount: 0,
      refundedCount: 0,
      refundedCents: 0,
      cancelledCount: 0,
      costCents: 0,
      revenueWithUnknownCostCents: 0,
      grossMarginCents: 0,
      grossMarginBps: 0,
      avgTicketCents: 0,
    });
  });

  it("never divides by zero — margins and ticket are 0 with no PAID sales", () => {
    const totals = computeSalesTotals([
      { quantity: 5, amountCents: 50_000, status: "PENDING" },
      { quantity: 1, amountCents: 10_000, status: "REFUNDED" },
    ]);
    expect(totals.grossMarginBps).toBe(0);
    expect(totals.avgTicketCents).toBe(0);
  });

  it("ignores unknown statuses defensively", () => {
    const totals = computeSalesTotals([
      { quantity: 1, amountCents: 42_000, status: "WHATEVER_FUTURE_STATUS" },
    ]);
    expect(totals.revenueCents).toBe(0);
    expect(totals.paidCount).toBe(0);
    expect(totals.pendingCount).toBe(0);
    expect(totals.refundedCount).toBe(0);
    expect(totals.cancelledCount).toBe(0);
  });

  it("is insensitive to input ordering (same rows, any sequence)", () => {
    const rows = [
      { quantity: 1, amountCents: 100, status: "PAID", unitCostCents: 10 },
      { quantity: 2, amountCents: 200, status: "PENDING" },
      { quantity: 3, amountCents: 400, status: "PAID", unitCostCents: 50 },
      { quantity: 1, amountCents: 500, status: "REFUNDED" },
    ];
    const reversed = [...rows].reverse();
    expect(computeSalesTotals(rows)).toEqual(computeSalesTotals(reversed));
  });

  it("supports margin going negative (selling below cost)", () => {
    const totals = computeSalesTotals([
      { quantity: 1, amountCents: 1000, status: "PAID", unitCostCents: 1500 },
    ]);
    expect(totals.grossMarginCents).toBe(-500);
    expect(totals.grossMarginBps).toBe(-5000);
  });
});
