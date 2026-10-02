import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import {
  createAnalyticsRepository,
  type AnalyticsDatabase,
} from "../repositories/analytics.repository";
import {
  buildAnalyticsMetrics,
  readAnalyticsMetrics,
  resolvePeriodDays,
  toAnalyticsPeriod,
  type AnalyticsMetrics,
  type AiUsageInput,
  type DeliveryUsageInput,
  type SnapshotSaleInput,
} from "../metrics/snapshot-builder";

export interface AnalyticsDashboardData {
  period: { from: string; to: string; days: number };
  metrics: AnalyticsMetrics;
  /** When the served payload was (re)computed (ISO). */
  computedAt: string;
  /** `true` when tenant sales changed after the snapshot was computed. */
  stale: boolean;
  /** Where the payload came from this request. */
  source: "snapshot" | "computed" | "refreshed";
}

export interface AnalyticsDashboardOptions {
  /** Inclusive day count covered (default 30). */
  days?: number;
  /** Injectable clock — deterministic in tests, `new Date()` at runtime. */
  now?: Date;
}

/**
 * Analytics service — PR008 (Analytics & Attribution).
 *
 * Lazy metrics pipeline: read the materialized `AnalyticsSnapshot` for the
 * (tenant, period) key; compute + persist it when missing. `refresh()`
 * forces recomputation (the dashboard "Recalcular" action).
 *
 * Every computation is deterministic and runs ONLY over the tenant's own
 * rows — no external tracking, no randomness, no network.
 */
export function createAnalyticsService(db: AnalyticsDatabase) {
  const repo = createAnalyticsRepository(db);

  async function compute(
    orgId: string,
    from: Date,
    to: Date,
    days: number,
    now: Date,
  ): Promise<{
    sales: SnapshotSaleInput[];
    aiUsage: AiUsageInput;
    deliveryUsage: DeliveryUsageInput;
    metrics: AnalyticsMetrics;
  }> {
    const [sales, aiUsage, deliveryUsage] = await Promise.all([
      repo.listSalesForPeriod(orgId, { from, to }),
      repo.aggregateAiUsage(orgId, { from, to }),
      repo.aggregateDeliveryUsage(orgId, { from, to }),
    ]);
    const metrics = buildAnalyticsMetrics(
      sales,
      aiUsage,
      toAnalyticsPeriod(from, to, days),
      deliveryUsage,
    );
    void now;
    return { sales, aiUsage, deliveryUsage, metrics };
  }

  return {
    /**
     * Serve the dashboard: snapshot-first, computing + persisting lazily
     * when no usable snapshot exists for the (tenant, period) key.
     *
     * PR014 — Motor Financeiro: when the stored snapshot is STALE (tenant
     * sales changed after it was computed — e.g. a webhook just ingested a
     * Mercado Livre order or a Mercado Pago payment), it is recomputed and
     * re-persisted inline, so the attribution tables (including "Receita
     * por canal de venda") always reflect the money that actually entered
     * through each active platform.
     */
    async getDashboard(
      organizationId: string,
      options: AnalyticsDashboardOptions = {},
    ): Promise<AnalyticsDashboardData> {
      const orgId = assertOrganizationId(organizationId);
      const days = options.days ?? 30;
      const now = options.now ?? new Date();
      const { from, to } = resolvePeriodDays(days, now);

      const [snapshot, maxSaleUpdatedAt] = await Promise.all([
        repo.findSnapshot(orgId, { from, to }),
        repo.maxSaleUpdatedAt(orgId, { from, to }),
      ]);

      const metrics = snapshot ? readAnalyticsMetrics(snapshot.metrics) : null;
      const stale = snapshot
        ? maxSaleUpdatedAt !== null && maxSaleUpdatedAt > snapshot.computedAt
        : false;
      if (snapshot && metrics && !stale) {
        return {
          period: metrics.period,
          metrics,
          computedAt: snapshot.computedAt.toISOString(),
          stale: false,
          source: "snapshot",
        };
      }

      const computed = await compute(orgId, from, to, days, now);
      const persisted = await repo.upsertSnapshot(
        orgId,
        { from, to },
        computed.metrics as unknown as Prisma.InputJsonValue,
        now,
      );

      return {
        period: computed.metrics.period,
        metrics: computed.metrics,
        computedAt: persisted.computedAt.toISOString(),
        stale: false,
        source: snapshot ? "refreshed" : "computed",
      };
    },

    /**
     * Recompute every already-materialized period containing a changed sale.
     * Called by the marketplace worker immediately after an idempotent Sale
     * create/update. A period not materialized yet remains lazy; the normal
     * dashboard read computes it on first access.
     */
    async refreshForSale(
      organizationId: string,
      occurredAt: Date,
      now: Date = new Date(),
    ): Promise<number> {
      const orgId = assertOrganizationId(organizationId);
      const ranges = await repo.listSnapshotsContainingDate(orgId, occurredAt);

      for (const { from, to } of ranges) {
        const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
        const computed = await compute(orgId, from, to, days, now);
        await repo.upsertSnapshot(
          orgId,
          { from, to },
          computed.metrics as unknown as Prisma.InputJsonValue,
          now,
        );
      }
      return ranges.length;
    },

    /** Force recomputation of the (tenant, period) snapshot. */
    async refresh(
      organizationId: string,
      options: AnalyticsDashboardOptions = {},
    ): Promise<AnalyticsDashboardData> {
      const orgId = assertOrganizationId(organizationId);
      const days = options.days ?? 30;
      const now = options.now ?? new Date();
      const { from, to } = resolvePeriodDays(days, now);

      const computed = await compute(orgId, from, to, days, now);
      const persisted = await repo.upsertSnapshot(
        orgId,
        { from, to },
        computed.metrics as unknown as Prisma.InputJsonValue,
        now,
      );

      return {
        period: computed.metrics.period,
        metrics: computed.metrics,
        computedAt: persisted.computedAt.toISOString(),
        stale: false,
        source: "refreshed",
      };
    },
  };
}

export const analyticsService = createAnalyticsService(prisma);
