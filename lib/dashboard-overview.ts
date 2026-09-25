import "server-only";
import { CampaignStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import { analyticsService } from "@/modules/analytics/services/analytics.service";
import type { AttributionRow } from "@/modules/analytics/metrics/attribution";

/**
 * Dashboard overview read model — PR010.1 (presentation layer only).
 *
 * The redesigned `/dashboard` needs a handful of headline numbers and three
 * small series to plot. Rather than inventing metrics, this module *reads*:
 *
 *   - every monetary figure, ROI and attribution ranking comes from the
 *     existing `analyticsService` snapshot pipeline (PR008) — untouched;
 *   - the entity counters are plain tenant-scoped `count()` queries;
 *   - the daily series buckets the tenant's own `Sale` rows by UTC day.
 *
 * NO BUSINESS RULE IS DEFINED HERE. The revenue convention (only `PAID` sales
 * count), the tenant scope for `Sale` (transitive through
 * product/creator/campaign) and the ROI definition are all reused verbatim
 * from `modules/analytics`. This file only shapes them for the UI.
 *
 * Tenant scope is mandatory on every query and always comes from the session.
 */

/** One point of the daily GMV / orders series. */
export interface DailyPoint extends Record<string, string | number> {
  /** `dd/MM` label for the X axis. */
  date: string;
  /** Gross merchandise value for the day, in integer cents. */
  gmvCents: number;
  /** Number of PAID sales that day. */
  orders: number;
}

export interface FunnelSlice {
  label: string;
  value: number;
}

export interface DashboardOverview {
  period: { days: number };
  /** Gross merchandise value (PAID revenue) in the period, integer cents. */
  gmvCents: number;
  /** PAID sales count in the period. */
  orders: number;
  /** Average ticket, integer cents. */
  avgTicketCents: number;
  /** Gross margin in integer cents, and ROI in basis points. */
  grossMarginCents: number;
  roiBps: number;
  /** Conversion proxy: PAID ÷ (PAID + PENDING) sales, basis points. */
  conversionBps: number;
  /** Tenant-wide entity counters (not period-bound). */
  counts: {
    products: number;
    creators: number;
    /** Campaigns currently in flight (RUNNING or SCHEDULED). */
    activeCampaigns: number;
    totalCampaigns: number;
  };
  /** Daily GMV + orders across the period. */
  daily: DailyPoint[];
  /** Top revenue contributors, already ranked by the analytics pipeline. */
  topProducts: AttributionRow[];
  topCreators: AttributionRow[];
  /** Creator pipeline distribution for the donut. */
  creatorFunnel: FunnelSlice[];
  /** `true` when the underlying snapshot predates the latest sale rows. */
  stale: boolean;
}

const DAY_MS = 86_400_000;

/**
 * What "campanha ativa" means on the overview: a campaign that is live or
 * about to go live. Mirrors the `CampaignStatus` enum — no new rule, just the
 * presentation grouping used by the KPI tile.
 */
const LIVE_CAMPAIGN_STATUSES = [CampaignStatus.RUNNING, CampaignStatus.SCHEDULED] as const;

/** UTC day-normalised half-open period `[from, to)` — mirrors PR008. */
function resolvePeriod(days: number, now: Date): { from: Date; to: Date } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS);
  const from = new Date(to.getTime() - days * DAY_MS);
  return { from, to };
}

/** `2026-09-23T00:00:00Z` → `23/09`. */
function dayLabel(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/**
 * Tenant filter for `Sale`, copied from
 * `modules/analytics/repositories/analytics.repository.ts`. `Sale` has no
 * direct `organizationId` column; the scope is transitive.
 */
function saleTenantWhere(organizationId: string) {
  const scope = assertOrganizationId(organizationId);
  // PR011.1: Sale agora tem organizationId direto; filtro simples pelo FK.
  return { organizationId: scope };
}

/** Human-facing pt-BR labels for the creator pipeline statuses. */
const CREATOR_STATUS_LABELS: Record<string, string> = {
  DISCOVERED: "Descobertos",
  CONTACTED: "Contatados",
  NEGOTIATING: "Negociando",
  ACTIVE: "Ativos",
  PAUSED: "Pausados",
  REJECTED: "Recusados",
};

export async function getDashboardOverview(
  organizationId: string,
  options: { days?: number; now?: Date } = {},
): Promise<DashboardOverview> {
  const scope = assertOrganizationId(organizationId);
  const days = options.days ?? 30;
  const now = options.now ?? new Date();
  const { from, to } = resolvePeriod(days, now);

  const [dashboard, products, creators, activeCampaigns, totalCampaigns, sales, creatorGroups] =
    await Promise.all([
      analyticsService.getDashboard(scope, { days, now }),
      prisma.product.count({ where: { organizationId: scope } }),
      prisma.creatorProfile.count({ where: { organizationId: scope } }),
      prisma.campaign.count({
        where: { organizationId: scope, status: { in: [...LIVE_CAMPAIGN_STATUSES] } },
      }),
      prisma.campaign.count({ where: { organizationId: scope } }),
      prisma.sale.findMany({
        where: { AND: [saleTenantWhere(scope), { occurredAt: { gte: from, lt: to } }] },
        select: { amountCents: true, status: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
      }),
      prisma.creatorProfile.groupBy({
        by: ["status"],
        where: { organizationId: scope },
        _count: { _all: true },
      }),
    ]);

  const { totals, attribution, roiBps } = dashboard.metrics;

  // Bucket PAID sales by UTC day, pre-seeding every day so the series has no
  // gaps (a gap would make the chart lie about a quiet day).
  const buckets = new Map<string, DailyPoint>();
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += DAY_MS) {
    const label = dayLabel(new Date(cursor));
    buckets.set(label, { date: label, gmvCents: 0, orders: 0 });
  }

  for (const sale of sales) {
    if (sale.status !== "PAID") continue;
    const point = buckets.get(dayLabel(sale.occurredAt));
    if (!point) continue;
    point.gmvCents += sale.amountCents;
    point.orders += 1;
  }

  const pipelineTotal = totals.paidCount + totals.pendingCount;
  const conversionBps =
    pipelineTotal > 0 ? Math.round((totals.paidCount / pipelineTotal) * 10_000) : 0;

  const creatorFunnel = creatorGroups
    .map((group) => ({
      label: CREATOR_STATUS_LABELS[group.status] ?? group.status,
      value: group._count._all,
    }))
    .filter((slice) => slice.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "pt-BR"));

  return {
    period: { days },
    gmvCents: totals.revenueCents,
    orders: totals.paidCount,
    avgTicketCents: totals.avgTicketCents,
    grossMarginCents: totals.grossMarginCents,
    roiBps,
    conversionBps,
    counts: { products, creators, activeCampaigns, totalCampaigns },
    daily: [...buckets.values()],
    topProducts: attribution.byProduct.slice(0, 6),
    topCreators: attribution.byCreator.slice(0, 6),
    creatorFunnel,
    stale: dashboard.stale,
  };
}
