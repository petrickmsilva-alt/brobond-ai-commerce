/**
 * Seed data generator for the Sales pipeline — PR008
 * (Analytics & Attribution).
 *
 * Pure and deterministic: same products/creators/campaigns + same `now`
 * → byte-identical sale list. No randomness anywhere — quantities,
 * statuses and dates are derived from stable index arithmetic.
 */

export interface SeedSaleProduct {
  id: string;
  priceCents: number;
}

export interface SeedSaleActor {
  id: string;
}

export interface SeedSaleDraft {
  organizationId: string;
  reference: string;
  quantity: number;
  amountCents: number;
  status: "PENDING" | "PAID" | "REFUNDED" | "CANCELLED";
  occurredAt: Date;
  productId: string;
  creatorId: string | null;
  campaignId: string | null;
}

/** Total number of generated sales. */
export const SEED_SALE_COUNT = 40;

/** Status distribution — 28 PAID · 5 PENDING · 4 REFUNDED · 3 CANCELLED. */
const SEED_PAID_COUNT = 28;
const SEED_PENDING_COUNT = 5;
const SEED_REFUNDED_COUNT = 4;
// the remaining 3 are CANCELLED

/**
 * Deterministic pseudo-distribution of 40 sales over the LAST 30 days
 * (relative to `now`), linked round-robin to the workspace's real
 * products/creators/campaigns so every attribution bucket has data.
 *
 * `organizationId` is the first argument (tenant-scope convention) and is
 * stamped on every draft — `Sale.organizationId` is required since PR011.1.
 */
export function buildSeedSales(
  organizationId: string,
  products: readonly SeedSaleProduct[],
  creators: readonly SeedSaleActor[],
  campaigns: readonly SeedSaleActor[],
  now: Date,
): SeedSaleDraft[] {
  if (products.length === 0) return [];

  return Array.from({ length: SEED_SALE_COUNT }, (_, index) => {
    const status: SeedSaleDraft["status"] =
      index < SEED_PAID_COUNT
        ? "PAID"
        : index < SEED_PAID_COUNT + SEED_PENDING_COUNT
          ? "PENDING"
          : index < SEED_PAID_COUNT + SEED_PENDING_COUNT + SEED_REFUNDED_COUNT
            ? "REFUNDED"
            : "CANCELLED";

    const product = products[index % products.length]!;
    const quantity = 1 + ((index * 7) % 3); // 1–3, stable
    // Spread deterministically over the last 30 days, newest first.
    const daysAgo = index % 30;
    const occurredAt = new Date(now.getTime() - daysAgo * 86_400_000 - (index % 5) * 3_600_000);

    return {
      organizationId,
      reference: `seed-sale-${String(index + 1).padStart(3, "0")}`,
      quantity,
      amountCents: product.priceCents * quantity,
      status,
      occurredAt,
      productId: product.id,
      creatorId: creators.length > 0 ? creators[index % creators.length]!.id : null,
      campaignId: campaigns.length > 0 ? campaigns[index % campaigns.length]!.id : null,
    };
  });
}
