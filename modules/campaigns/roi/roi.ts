/** Monetary inputs use integer cents. Rates are percentages in [0, 100]. */
export interface ROIInput {
  predictedRevenueCents: number;
  /** Gross margin percentage before commission and outbound freight. */
  marginPercent: number;
  commissionPercent: number;
  freightCents: number;
}

export interface ROIEstimate {
  predictedRevenueCents: number;
  grossMarginCents: number;
  commissionCents: number;
  freightCents: number;
  predictedProfitCents: number;
  roiPercent: number;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Deterministic projected ROI against total campaign cost (commission + freight). */
export function estimateROI(input: ROIInput): ROIEstimate {
  const revenue = Math.round(nonNegative(input.predictedRevenueCents));
  const marginRate = Math.min(100, nonNegative(input.marginPercent)) / 100;
  const commissionRate = Math.min(100, nonNegative(input.commissionPercent)) / 100;
  const freight = Math.round(nonNegative(input.freightCents));
  const grossMargin = Math.round(revenue * marginRate);
  const commission = Math.round(revenue * commissionRate);
  const profit = grossMargin - commission - freight;
  const investment = commission + freight;
  const roiPercent =
    investment === 0 ? (profit > 0 ? 100 : 0) : Math.round((profit / investment) * 10_000) / 100;
  return {
    predictedRevenueCents: revenue,
    grossMarginCents: grossMargin,
    commissionCents: commission,
    freightCents: freight,
    predictedProfitCents: profit,
    roiPercent,
  };
}
