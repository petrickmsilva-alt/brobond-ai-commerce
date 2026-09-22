/**
 * Pricing engine — pure margin math (no Prisma, no session, no I/O).
 *
 * CONVENTIONS
 * -----------
 * - All money values are integer **cents** (never floats of reais).
 * - Margin is stored as integer **basis points** (bps): 3550 = 35.50%.
 *   Basis points keep the value sortable/filterable at the database level
 *   without floating-point drift.
 */

/** Cost components that make up a unit cost (all integer cents). */
export interface CostComponents {
  unitCents: number;
  freightCents?: number;
  packagingCents?: number;
  feesCents?: number;
  otherCents?: number;
}

/** Basis points in 100%. */
export const BPS_IN_100_PERCENT = 10_000;

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer (got ${value}).`);
  }
}

/** Total unit cost = unit + freight + packaging + fees + other. */
export function totalCostCents(components: CostComponents): number {
  const {
    unitCents,
    freightCents = 0,
    packagingCents = 0,
    feesCents = 0,
    otherCents = 0,
  } = components;
  assertNonNegativeInt(unitCents, "unitCents");
  assertNonNegativeInt(freightCents, "freightCents");
  assertNonNegativeInt(packagingCents, "packagingCents");
  assertNonNegativeInt(feesCents, "feesCents");
  assertNonNegativeInt(otherCents, "otherCents");
  return unitCents + freightCents + packagingCents + feesCents + otherCents;
}

/** Absolute gross profit per unit. May be negative when selling below cost. */
export function profitCents(priceCents: number, costCents: number): number {
  assertNonNegativeInt(priceCents, "priceCents");
  assertNonNegativeInt(costCents, "costCents");
  return priceCents - costCents;
}

/**
 * Gross margin in basis points: `(price - cost) / price * 10000`, rounded.
 *
 * - `price = 0` → `0` bps (undefined margin is treated as zero, never NaN).
 * - Selling below cost yields a **negative** margin.
 */
export function marginBps(priceCents: number, costCents: number): number {
  assertNonNegativeInt(priceCents, "priceCents");
  assertNonNegativeInt(costCents, "costCents");
  if (priceCents === 0) return 0;
  return Math.round(((priceCents - costCents) / priceCents) * BPS_IN_100_PERCENT);
}

/** Basis points → percentage number (3550 → 35.5). */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}

/** Format basis points for display: 3550 → "35,50%" (pt-BR by default). */
export function formatMarginBps(bps: number, locale = "pt-BR"): string {
  return (
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(bpsToPercent(bps)) + "%"
  );
}
