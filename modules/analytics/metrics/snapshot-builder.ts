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

/** Delivery usage aggregate for the same period (from `DeliveryMessage`, PR010 §11). */
export interface DeliveryUsageInput {
  /** Messages handed to the provider (sentAt inside the period). */
  messagesSent: number;
  /** Provider delivery receipts (deliveredAt inside the period). */
  messagesDelivered: number;
  /** Provider read receipts (readAt inside the period). */
  messagesRead: number;
  /** Terminal failures observed in the period. */
  messagesFailed: number;
  /** Currently queued/sending backlog (point-in-time, not period-bound). */
  messagesQueued: number;
}

export interface DeliveryMetrics {
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  messagesFailed: number;
  messagesQueued: number;
  /** delivered ÷ sent, integer basis points (0 when nothing was sent). */
  deliveryRate: number;
  /** read ÷ delivered, integer basis points (0 when nothing was delivered). */
  readRate: number;
}

export const ZERO_DELIVERY_USAGE: DeliveryUsageInput = {
  messagesSent: 0,
  messagesDelivered: 0,
  messagesRead: 0,
  messagesFailed: 0,
  messagesQueued: 0,
};

/** Rate as integer basis points — deterministic, division-safe. */
export function rateBps(numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) return 0;
  return Math.round((numerator / denominator) * 10_000);
}

export function buildDeliveryMetrics(usage: DeliveryUsageInput): DeliveryMetrics {
  return {
    messagesSent: usage.messagesSent,
    messagesDelivered: usage.messagesDelivered,
    messagesRead: usage.messagesRead,
    messagesFailed: usage.messagesFailed,
    messagesQueued: usage.messagesQueued,
    deliveryRate: rateBps(usage.messagesDelivered, usage.messagesSent),
    readRate: rateBps(usage.messagesRead, usage.messagesDelivered),
  };
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
  /** Omnichannel delivery funnel (PR010). Additive: absent in pre-PR010
   * snapshots — `readAnalyticsMetrics` backfills zeros. */
  delivery: DeliveryMetrics;
}

/**
 * Build the deterministic metrics payload for one tenant-period.
 *
 * @param sales         every PAID/PENDING/REFUNDED/CANCELLED sale of the
 *                      tenant whose `occurredAt` falls inside `[from, to)`
 * @param aiUsage       token/message aggregate over the same period
 * @param period        UTC ISO period (day-normalized)
 * @param deliveryUsage delivery receipt counters over the same period
 *                      (PR010 — omitted/zero for tenants without delivery)
 */
export function buildAnalyticsMetrics(
  sales: readonly SnapshotSaleInput[],
  aiUsage: AiUsageInput,
  period: AnalyticsPeriod,
  deliveryUsage: DeliveryUsageInput = ZERO_DELIVERY_USAGE,
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
    delivery: buildDeliveryMetrics(deliveryUsage),
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
  // PR010 additive field: snapshots persisted before the delivery engine
  // carry no `delivery` key — backfill the zero baseline instead of
  // invalidating an otherwise perfect snapshot.
  if (typeof candidate.delivery !== "object" || candidate.delivery === null) {
    candidate.delivery = buildDeliveryMetrics(ZERO_DELIVERY_USAGE);
  }
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
