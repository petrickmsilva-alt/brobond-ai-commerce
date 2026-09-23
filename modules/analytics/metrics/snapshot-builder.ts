/**
 * Analytics snapshot builder — PR008 (Analytics & Attribution).
 *
 * Pure composition of the metrics modules: takes the raw period rows
 * (sales with their attribution labels + AI usage aggregate) and produces
 * the full, versioned, deterministic `metrics` JSON payload persisted on
 * `AnalyticsSnapshot.metrics`.
 *
 * DETERMINISM CONTRACT: same rows (in any order) + same period →
 * byte-identical JSON. All money is integer cents, all rates integer
 * basis points, all dates UTC ISO strings.
 */

import { computeSalesTotals, type SalesTotals } from "./sales-metrics";
import { attributeRevenue, projectDimension, type AttributionRow } from "./attribution";
import { estimateCostUsdCents } from "@/modules/ai/openai/pricing";

/** Bump only on a breaking change of the metrics payload shape. */
export const ANALYTICS_SNAPSHOT_VERSION = 1;

export interface AnalyticsPeriod {
  /** Half-open period `[from, to)` (UTC ISO strings, day-normalized). */
  from: string;
  to: string;
  /** Inclusive day count covered by the period. */
  days: number;
}

/** One sale row as projected by the repository (with relations resolved). */
export interface SnapshotSaleInput {
  quantity: number;
  amountCents: number;
  status: string;
  occurredAt: string;
  productId: string | null;
  productName: string | null;
  productCostCents: number | null;
  creatorId: string | null;
  creatorName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

/** AI usage aggregate for the same period (from `AIGeneratedMessage`). */
export interface AiUsageInput {
  totalMessages: number;
  inputTokens: number;
  outputTokens: number;
  /** Per-model token usage (needed for exact cost estimation). */
  byModel: Array<{ model: string; inputTokens: number; outputTokens: number }>;
  /** Message count per tone (stable — mirrors the `AiMessageTone` enum). */
  byTone: Record<string, number>;
}

export interface AiUsageMetrics {
  totalMessages: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsdCents: number;
  byTone: Record<string, number>;
}

export interface AnalyticsMetrics {
  version: number;
  period: AnalyticsPeriod;
  totals: SalesTotals;
  /** ROI over estimated COGS, basis points of revenue (equals grossMarginBps). */
  roiBps: number;
  attribution: {
    byProduct: AttributionRow[];
    byCreator: AttributionRow[];
    byCampaign: AttributionRow[];
  };
  ai: AiUsageMetrics;
}

/**
 * Build the deterministic metrics payload for one tenant-period.
 *
 * @param sales   every PAID/PENDING/REFUNDED/CANCELLED sale of the tenant
 *                whose `occurredAt` falls inside `[from, to)`
 * @param aiUsage token/message aggregate over the same period
 * @param period  UTC ISO period (day-normalized)
 */
export function buildAnalyticsMetrics(
  sales: readonly SnapshotSaleInput[],
  aiUsage: AiUsageInput,
  period: AnalyticsPeriod,
): AnalyticsMetrics {
  const metricSales = sales.map((sale) => ({
    quantity: sale.quantity,
    amountCents: sale.amountCents,
    status: sale.status,
    unitCostCents: sale.productCostCents,
  }));

  const totals = computeSalesTotals(metricSales);

  const estimatedCostUsdCents = aiUsage.byModel.reduce(
    (total, row) => total + estimateCostUsdCents(row.model, row.inputTokens, row.outputTokens),
    0,
  );

  return {
    version: ANALYTICS_SNAPSHOT_VERSION,
    period,
    totals,
    roiBps: totals.grossMarginBps,
    attribution: {
      byProduct: attributeRevenue(
        projectDimension(sales, (sale) => ({
          key: sale.productId,
          label: sale.productName,
        })),
      ),
      byCreator: attributeRevenue(
        projectDimension(sales, (sale) => ({
          key: sale.creatorId,
          label: sale.creatorName,
        })),
      ),
      byCampaign: attributeRevenue(
        projectDimension(sales, (sale) => ({
          key: sale.campaignId,
          label: sale.campaignName,
        })),
      ),
    },
    ai: {
      totalMessages: aiUsage.totalMessages,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      estimatedCostUsdCents,
      byTone: aiUsage.byTone,
    },
  };
}

/** Reader: narrow unknown JSON (from Prisma) into the expected payload. */
export function readAnalyticsMetrics(value: unknown): AnalyticsMetrics | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== ANALYTICS_SNAPSHOT_VERSION) return null;
  if (typeof candidate.period !== "object" || candidate.period === null) return null;
  if (typeof candidate.totals !== "object" || candidate.totals === null) return null;
  if (typeof candidate.attribution !== "object" || candidate.attribution === null) return null;
  if (typeof candidate.ai !== "object" || candidate.ai === null) return null;
  return candidate as unknown as AnalyticsMetrics;
}

/**
 * Period helpers — day-normalized, UTC, half-open `[from, to)`.
 * `daysAgo(30, now)` covers the last 30 *days* INCLUDING today's partial
 * day: `from = startOfUtcDay(now - 29d)`, `to = startOfUtcDay(now) + 1d`.
 */
export function resolvePeriodDays(days: number, now: Date): { from: Date; to: Date } {
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + 86_400_000,
  );
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from, to };
}

export function toAnalyticsPeriod(from: Date, to: Date, days: number): AnalyticsPeriod {
  return { from: from.toISOString(), to: to.toISOString(), days };
}
