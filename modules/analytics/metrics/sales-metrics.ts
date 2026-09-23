/**
 * Sales metrics — PR008 (Analytics & Attribution).
 *
 * Pure, framework-free and Prisma-free functions over plain sale rows.
 * The repository projects Prisma rows into `SaleMetricInput`; every number
 * here is an integer (money = cents, rates = basis points), matching the
 * codebase's money contract.
 *
 * Revenue convention: **only `PAID` sales count as revenue** (mirrors
 * `modules/sales/sales.service.ts#totalRevenueCents`). PENDING sales are
 * reported separately; REFUNDED/CANCELLED never count as revenue.
 */

export type SaleStatusLike = "PENDING" | "PAID" | "REFUNDED" | "CANCELLED";

export interface SaleMetricInput {
  quantity: number;
  amountCents: number;
  status: SaleStatusLike | string;
  /**
   * Estimated unit cost in cents at read time (`Product.currentCostCents`).
   * `null` when the sale's product is unknown (SetNull) or unsold — the
   * margin math then treats cost as 0 and documents it via `unknownCostCents`
   * totals (conservative: unknown cost never *reduces* the margin).
   */
  unitCostCents?: number | null;
}

export interface SalesTotals {
  /** Sum of `amountCents` over PAID sales. */
  revenueCents: number;
  /** Sum of `quantity` over PAID sales. */
  unitsSold: number;
  /** Number of PAID sales. */
  paidCount: number;
  /** Number of PENDING sales (pipeline, not revenue). */
  pendingCount: number;
  /** Number of REFUNDED sales + their amount (never revenue). */
  refundedCount: number;
  refundedCents: number;
  /** Number of CANCELLED sales. */
  cancelledCount: number;
  /** Estimated COGS over PAID sales (`unitCostCents × quantity`, unknown → 0). */
  costCents: number;
  /**
   * Share of the PAID revenue whose unit cost was unknown (`unitCostCents`
   * null). Exposed so the margin's confidence can be judged.
   */
  revenueWithUnknownCostCents: number;
  /** `revenueCents - costCents` (may exceed revenue only when cost unknown). */
  grossMarginCents: number;
  /** Gross margin in basis points of revenue (0 when revenue is 0). */
  grossMarginBps: number;
  /** Average ticket over PAID sales: `revenueCents / paidCount`, rounded. */
  avgTicketCents: number;
}

/**
 * Integer basis-point ratio `part / whole * 10_000`, rounded to nearest.
 * Returns 0 when `whole <= 0` (avoids division by zero and NaN leaks into
 * JSON snapshots).
 */
export function ratioBps(part: number, whole: number): number {
  if (whole <= 0 || part === 0) return 0;
  return Math.round((part / whole) * 10_000);
}

/** Aggregate a list of sale rows into the canonical totals object. */
export function computeSalesTotals(sales: readonly SaleMetricInput[]): SalesTotals {
  let revenueCents = 0;
  let unitsSold = 0;
  let paidCount = 0;
  let pendingCount = 0;
  let refundedCount = 0;
  let refundedCents = 0;
  let cancelledCount = 0;
  let costCents = 0;
  let revenueWithUnknownCostCents = 0;

  for (const sale of sales) {
    switch (sale.status) {
      case "PAID":
        revenueCents += sale.amountCents;
        unitsSold += sale.quantity;
        paidCount += 1;
        if (sale.unitCostCents == null) {
          revenueWithUnknownCostCents += sale.amountCents;
        } else {
          costCents += sale.unitCostCents * sale.quantity;
        }
        break;
      case "PENDING":
        pendingCount += 1;
        break;
      case "REFUNDED":
        refundedCount += 1;
        refundedCents += sale.amountCents;
        break;
      case "CANCELLED":
        cancelledCount += 1;
        break;
      default:
        // Unknown status (defensive — the DB enum is closed): treat as
        // non-revenue, non-pipeline. Never counted anywhere.
        break;
    }
  }

  const grossMarginCents = revenueCents - costCents;

  return {
    revenueCents,
    unitsSold,
    paidCount,
    pendingCount,
    refundedCount,
    refundedCents,
    cancelledCount,
    costCents,
    revenueWithUnknownCostCents,
    grossMarginCents,
    grossMarginBps: ratioBps(grossMarginCents, revenueCents),
    avgTicketCents: paidCount > 0 ? Math.round(revenueCents / paidCount) : 0,
  };
}
