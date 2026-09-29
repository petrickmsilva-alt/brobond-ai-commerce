/**
 * Revenue attribution — PR008 (Analytics & Attribution).
 *
 * Pure, framework-free: assigns each PAID sale to exactly one attribution
 * bucket — its product, its creator, or its campaign — and ranks the
 * buckets deterministically.
 *
 * Sales whose relation was nulled (onDelete: SetNull) fall into the
 * synthetic `UNATTRIBUTED` bucket instead of disappearing, so every real
 * cent of revenue is accounted for and the share column always sums to
 * ~100%.
 */

import type { SaleMetricInput } from "./sales-metrics";
import { ratioBps } from "./sales-metrics";

export type AttributionDimension = "product" | "creator" | "campaign";

/** Synthetic bucket key for sales whose relation for the dimension is null. */
export const UNATTRIBUTED_KEY = "__unattributed__";

/** Human-facing label of the synthetic bucket (pt-BR, matches the UI). */
export const UNATTRIBUTED_LABEL = "— Sem atribuição";

export interface AttributableSale extends SaleMetricInput {
  key?: string | null;
  label?: string | null;
}

export interface AttributionRow {
  /** Dimension id, or `UNATTRIBUTED_KEY` for the synthetic bucket. */
  key: string;
  label: string;
  /** Sum of `amountCents` over the bucket's PAID sales. */
  revenueCents: number;
  /** Number of PAID sales in the bucket. */
  salesCount: number;
  /** Sum of `quantity` over the bucket's PAID sales. */
  unitsSold: number;
  /** Bucket revenue as basis points of total revenue (0 when total is 0). */
  shareBps: number;
}

/**
 * Attribute PAID revenue to buckets of one dimension.
 *
 * Deterministic ordering: revenue desc · label asc (byte order) · key asc —
 * the output is byte-identical for any input permutation of the same rows.
 */
export function attributeRevenue(sales: readonly AttributableSale[]): AttributionRow[] {
  const buckets = new Map<
    string,
    { label: string; revenueCents: number; salesCount: number; unitsSold: number }
  >();

  for (const sale of sales) {
    if (sale.status !== "PAID") continue;
    const key = sale.key ?? UNATTRIBUTED_KEY;
    const label = sale.label ?? (sale.key == null ? UNATTRIBUTED_LABEL : UNATTRIBUTED_KEY);
    const bucket = buckets.get(key) ?? { label, revenueCents: 0, salesCount: 0, unitsSold: 0 };
    bucket.revenueCents += sale.amountCents;
    bucket.salesCount += 1;
    bucket.unitsSold += sale.quantity;
    buckets.set(key, bucket);
  }

  const totalRevenueCents = [...buckets.values()].reduce((sum, b) => sum + b.revenueCents, 0);

  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: bucket.label,
      revenueCents: bucket.revenueCents,
      salesCount: bucket.salesCount,
      unitsSold: bucket.unitsSold,
      shareBps: ratioBps(bucket.revenueCents, totalRevenueCents),
    }))
    .sort(
      (a, b) =>
        b.revenueCents - a.revenueCents ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
}

/** Convenience: project domain rows into `AttributableSale[]` for one dimension. */
export function projectDimension<T extends SaleMetricInput>(
  sales: readonly T[],
  pick: (sale: T) => { key?: string | null; label?: string | null },
): AttributableSale[] {
  return sales.map((sale) => ({
    quantity: sale.quantity,
    amountCents: sale.amountCents,
    status: sale.status,
    unitCostCents: sale.unitCostCents,
    ...pick(sale),
  }));
}
