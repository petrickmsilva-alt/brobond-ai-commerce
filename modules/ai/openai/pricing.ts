/**
 * Approximate OpenAI Responses API pricing, used only to render the
 * "estimated cost" KPI on `/dashboard/ai`. Not billing-accurate — OpenAI's
 * published per-model rates change over time; this is a best-effort
 * dashboard estimate, never used for invoicing.
 *
 * Rates are USD cents per 1,000 tokens.
 */
const MODEL_RATES_USD_CENTS_PER_1K: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.015, output: 0.06 },
  "gpt-4o": { input: 0.25, output: 1.0 },
};

const DEFAULT_RATE = MODEL_RATES_USD_CENTS_PER_1K["gpt-4o-mini"]!;

/** Estimate the USD cost (in cents) of a single generation call. */
export function estimateCostUsdCents(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = MODEL_RATES_USD_CENTS_PER_1K[model] ?? DEFAULT_RATE;
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}

/**
 * Format an estimated USD-cents amount as a currency string with enough
 * decimal precision to be meaningful for small token counts (dashboard-only
 * display, not billing-accurate — see module doc comment above).
 */
export function formatEstimatedCost(usdCents: number): string {
  const usd = usdCents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(usd);
}
