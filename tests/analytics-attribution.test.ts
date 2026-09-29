import { describe, expect, it } from "vitest";
import {
  attributeRevenue,
  projectDimension,
  UNATTRIBUTED_KEY,
  UNATTRIBUTED_LABEL,
} from "@/modules/analytics/metrics/attribution";

describe("attributeRevenue() — PR008", () => {
  it("aggregates PAID revenue per bucket with share in bps", () => {
    const rows = attributeRevenue([
      { quantity: 1, amountCents: 30_000, status: "PAID", key: "p1", label: "Produto A" },
      { quantity: 2, amountCents: 20_000, status: "PAID", key: "p2", label: "Produto B" },
      { quantity: 1, amountCents: 10_000, status: "PAID", key: "p1", label: "Produto A" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      key: "p1",
      label: "Produto A",
      revenueCents: 40_000,
      salesCount: 2,
      unitsSold: 2,
      shareBps: 6667,
    });
    expect(rows[1]).toEqual({
      key: "p2",
      label: "Produto B",
      revenueCents: 20_000,
      salesCount: 1,
      unitsSold: 2,
      shareBps: 3333,
    });
  });

  it("excludes non-PAID statuses from revenue buckets", () => {
    const rows = attributeRevenue([
      { quantity: 1, amountCents: 10_000, status: "PAID", key: "p1", label: "A" },
      { quantity: 1, amountCents: 99_000, status: "PENDING", key: "p2", label: "B" },
      { quantity: 1, amountCents: 88_000, status: "REFUNDED", key: "p3", label: "C" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("p1");
    expect(rows[0]?.shareBps).toBe(10_000);
  });

  it("routes null keys to the synthetic un-attributed bucket", () => {
    const rows = attributeRevenue([
      { quantity: 1, amountCents: 2000, status: "PAID", key: null },
      { quantity: 1, amountCents: 6000, status: "PAID", key: "p1", label: "A" },
      { quantity: 1, amountCents: 2000, status: "PAID", key: null },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.key).toBe("p1");
    expect(rows[1]).toMatchObject({
      key: UNATTRIBUTED_KEY,
      label: UNATTRIBUTED_LABEL,
      revenueCents: 4000,
      salesCount: 2,
      shareBps: 4000,
    });
  });

  it("treats undefined keys exactly like null keys", () => {
    const rows = attributeRevenue([
      { quantity: 1, amountCents: 500, status: "PAID" },
      { quantity: 1, amountCents: 500, status: "PAID", key: null },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe(UNATTRIBUTED_KEY);
    expect(rows[0]?.revenueCents).toBe(1000);
  });

  it("orders by revenue desc, then label asc, then key asc (fully deterministic)", () => {
    const input = [
      { quantity: 1, amountCents: 100, status: "PAID", key: "k3", label: "Bravo" },
      { quantity: 1, amountCents: 300, status: "PAID", key: "k1", label: "Zulu" },
      { quantity: 1, amountCents: 100, status: "PAID", key: "k2", label: "Alfa" },
      { quantity: 1, amountCents: 100, status: "PAID", key: "k4", label: "Alfa" },
    ];
    const a = attributeRevenue(input).map((row) => row.key);
    const b = attributeRevenue([...input].reverse()).map((row) => row.key);
    expect(a).toEqual(b);
    expect(a).toEqual(["k1", "k2", "k4", "k3"]);
  });

  it("keeps share ~100% via rounding to nearest (never NaN)", () => {
    const rows = attributeRevenue(
      Array.from({ length: 3 }, (_, i) => ({
        quantity: 1,
        amountCents: 100,
        status: "PAID",
        key: `k${i}`,
        label: `L${i}`,
      })),
    );
    const totalShare = rows.reduce((sum, row) => sum + row.shareBps, 0);
    expect(totalShare).toBeGreaterThanOrEqual(9999);
    expect(totalShare).toBeLessThanOrEqual(10_001);
  });

  it("returns an empty list for no PAID sales (share math never divides by zero)", () => {
    expect(attributeRevenue([])).toEqual([]);
    expect(
      attributeRevenue([{ quantity: 1, amountCents: 100, status: "PENDING", key: "p1" }]),
    ).toEqual([]);
  });

  it("never NaNs share when total revenue is zero", () => {
    const rows = attributeRevenue([
      { quantity: 1, amountCents: 0, status: "PAID", key: "p1", label: "Free" },
    ]);
    expect(rows[0]?.shareBps).toBe(0);
  });
});

describe("projectDimension() — PR008", () => {
  it("projects domain rows preserving metric fields and picking key/label", () => {
    const domain = [
      {
        quantity: 2,
        amountCents: 1000,
        status: "PAID",
        unitCostCents: 200,
        productId: "p1",
        productName: "Produto",
        creatorId: "c1",
      },
    ];
    const projected = projectDimension(domain, (sale) => ({
      key: sale.productId,
      label: sale.productName,
    }));
    expect(projected).toEqual([
      {
        quantity: 2,
        amountCents: 1000,
        status: "PAID",
        unitCostCents: 200,
        key: "p1",
        label: "Produto",
      },
    ]);
  });

  it("does not mutate the input rows", () => {
    const domain = [
      { quantity: 1, amountCents: 100, status: "PAID", productId: "p1", productName: "X" },
    ];
    const frozen = JSON.parse(JSON.stringify(domain));
    projectDimension(domain, (sale) => ({ key: sale.productId, label: sale.productName }));
    expect(domain).toEqual(frozen);
  });
});
