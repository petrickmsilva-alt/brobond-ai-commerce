import { describe, expect, it } from "vitest";
import { buildSeedSales, SEED_SALE_COUNT } from "@/modules/analytics/seed/sales-seed";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const ORG = "org_seed";

const products = [
  { id: "p1", priceCents: 29_900 },
  { id: "p2", priceCents: 9900 },
  { id: "p3", priceCents: 45_000 },
];
const creators = [{ id: "c1" }, { id: "c2" }];
const campaigns = [{ id: "cp1" }];

describe("buildSeedSales() — PR008", () => {
  it(`generates exactly ${SEED_SALE_COUNT} sales`, () => {
    expect(buildSeedSales(ORG, products, creators, campaigns, NOW)).toHaveLength(SEED_SALE_COUNT);
  });

  it("is fully deterministic for the same inputs", () => {
    const a = buildSeedSales(ORG, products, creators, campaigns, NOW);
    const b = buildSeedSales(ORG, products, creators, campaigns, NOW);
    expect(a).toEqual(b);
  });

  it("honors the status distribution (28 PAID · 5 PENDING · 4 REFUNDED · 3 CANCELLED)", () => {
    const rows = buildSeedSales(ORG, products, creators, campaigns, NOW);
    const counts = rows.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = (acc[row.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ PAID: 28, PENDING: 5, REFUNDED: 4, CANCELLED: 3 });
  });

  it("links every sale to a real product of the workspace", () => {
    const ids = new Set(products.map((product) => product.id));
    for (const row of buildSeedSales(ORG, products, creators, campaigns, NOW)) {
      expect(ids.has(row.productId)).toBe(true);
    }
  });

  it("links creators/campaigns round-robin (null-safe when lists are empty)", () => {
    const rows = buildSeedSales(ORG, products, creators, campaigns, NOW);
    expect(rows.every((row) => row.creatorId === "c1" || row.creatorId === "c2")).toBe(true);
    expect(rows.every((row) => row.campaignId === "cp1")).toBe(true);
    expect(rows.filter((row) => row.creatorId === "c2")).not.toHaveLength(0);

    const withoutActors = buildSeedSales(ORG, products, [], [], NOW);
    expect(withoutActors.every((row) => row.creatorId === null && row.campaignId === null)).toBe(
      true,
    );
  });

  it("computes amountCents = priceCents × quantity with quantity in 1–3", () => {
    const byId = new Map(products.map((product) => [product.id, product.priceCents]));
    for (const row of buildSeedSales(ORG, products, creators, campaigns, NOW)) {
      expect(row.quantity).toBeGreaterThanOrEqual(1);
      expect(row.quantity).toBeLessThanOrEqual(3);
      expect(row.amountCents).toBe((byId.get(row.productId) ?? 0) * row.quantity);
    }
  });

  it("spreads sales over the last 30 days, never in the future", () => {
    for (const row of buildSeedSales(ORG, products, creators, campaigns, NOW)) {
      const ageMs = NOW.getTime() - row.occurredAt.getTime();
      expect(ageMs).toBeGreaterThanOrEqual(0);
      expect(ageMs).toBeLessThan(31 * 86_400_000);
    }
  });

  it("emits unique, stable references", () => {
    const rows = buildSeedSales(ORG, products, creators, campaigns, NOW);
    expect(new Set(rows.map((row) => row.reference)).size).toBe(SEED_SALE_COUNT);
    expect(rows.map((row) => row.reference)).toEqual(
      buildSeedSales(ORG, products, creators, campaigns, NOW).map((row) => row.reference),
    );
  });

  it("returns an empty list when the workspace has no products", () => {
    expect(buildSeedSales(ORG, [], creators, campaigns, NOW)).toEqual([]);
  });
});
