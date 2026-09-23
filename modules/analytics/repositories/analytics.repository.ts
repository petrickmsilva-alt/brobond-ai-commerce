import "server-only";
import type {
  AiMessageTone,
  AnalyticsSnapshot,
  Prisma,
  PrismaClient,
  SaleStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId, tenantWhere } from "@/lib/tenant";
import {
  ZERO_DELIVERY_USAGE,
  type AiUsageInput,
  type DeliveryUsageInput,
  type SnapshotSaleInput,
} from "../metrics/snapshot-builder";

export type AnalyticsDatabase = Pick<
  PrismaClient,
  "sale" | "aIGeneratedMessage" | "analyticsSnapshot"
> &
  /**
   * PR010 additive: `deliveryMessage` is optional so pre-PR010 consumers
   * (and their bounded contexts) keep working — absence yields a zero
   * delivery baseline, never an error.
   */
  Partial<Pick<PrismaClient, "deliveryMessage">>;

export interface AnalyticsPeriodRange {
  from: Date;
  to: Date;
}

/**
 * Tenant filter for `Sale` — mirrors `modules/sales/sales.service.ts`.
 * `Sale` carries no direct `organizationId` column; the tenant scope is
 * transitive through product/creator/campaign (promoting `Sale` to a
 * direct tenant FK is tracked for a later PR). Until then, no analytics
 * query runs without this relational scope.
 */
function saleTenantWhere(organizationId: string): Prisma.SaleWhereInput {
  const scope = assertOrganizationId(organizationId);
  return {
    OR: [
      { product: { organizationId: scope } },
      { creator: { organizationId: scope } },
      { campaign: { organizationId: scope } },
    ],
  };
}

const salePeriodSelect = {
  quantity: true,
  amountCents: true,
  status: true,
  occurredAt: true,
  productId: true,
  creatorId: true,
  campaignId: true,
  product: { select: { name: true, currentCostCents: true } },
  creator: { select: { displayName: true } },
  campaign: { select: { name: true } },
} satisfies Prisma.SaleSelect;

/**
 * Repository for the Analytics & Attribution pipeline (PR008).
 * `organizationId` is ALWAYS the first argument — see `lib/tenant.ts`.
 */
export function createAnalyticsRepository(db: AnalyticsDatabase) {
  return {
    /**
     * Every sale of the tenant inside the half-open period `[from, to)`,
     * projected (with attribution relations resolved) for the pure metrics
     * pipeline. Non-revenue statuses are included — the metrics layer
     * decides what counts as revenue.
     */
    async listSalesForPeriod(
      organizationId: string,
      range: AnalyticsPeriodRange,
    ): Promise<SnapshotSaleInput[]> {
      const scope = assertOrganizationId(organizationId);
      const rows = await db.sale.findMany({
        where: {
          AND: [saleTenantWhere(scope), { occurredAt: { gte: range.from, lt: range.to } }],
        },
        select: salePeriodSelect,
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      });

      return rows.map((row) => ({
        quantity: row.quantity,
        amountCents: row.amountCents,
        status: row.status as SaleStatus | string,
        occurredAt: row.occurredAt.toISOString(),
        productId: row.productId,
        productName: row.product?.name ?? null,
        productCostCents: row.product?.currentCostCents ?? null,
        creatorId: row.creatorId,
        creatorName: row.creator?.displayName ?? null,
        campaignId: row.campaignId,
        campaignName: row.campaign?.name ?? null,
      }));
    },

    /**
     * Latest `updatedAt` among the tenant's sales in the period — used to
     * detect that a materialized snapshot predates the underlying rows
     * (staleness check, never trusted from the client).
     */
    async maxSaleUpdatedAt(
      organizationId: string,
      range: AnalyticsPeriodRange,
    ): Promise<Date | null> {
      const scope = assertOrganizationId(organizationId);
      const result = await db.sale.aggregate({
        _max: { updatedAt: true },
        where: {
          AND: [saleTenantWhere(scope), { occurredAt: { gte: range.from, lt: range.to } }],
        },
      });
      return result._max.updatedAt ?? null;
    },

    /**
     * Delivery usage aggregate (PR010 §11) over the same period:
     * messagesSent/messagesDelivered/messagesRead are receipt-dated
     * (sentAt/deliveredAt/readAt inside `[from, to)`); failures are dated
     * by their terminal update; the queue backlog is a point-in-time gauge.
     * Returns the zero baseline when the delivery module is not wired.
     */
    async aggregateDeliveryUsage(
      organizationId: string,
      range: AnalyticsPeriodRange,
    ): Promise<DeliveryUsageInput> {
      const scope = tenantWhere(organizationId);
      const period: Prisma.DateTimeFilter = { gte: range.from, lt: range.to };
      const delivery = db.deliveryMessage;
      if (!delivery) return { ...ZERO_DELIVERY_USAGE };

      const [messagesSent, messagesDelivered, messagesRead, messagesFailed, messagesQueued] =
        await Promise.all([
          delivery.count({ where: { ...scope, sentAt: period } }),
          delivery.count({ where: { ...scope, deliveredAt: period } }),
          delivery.count({ where: { ...scope, readAt: period } }),
          delivery.count({ where: { ...scope, status: "FAILED", updatedAt: period } }),
          delivery.count({ where: { ...scope, status: { in: ["QUEUED", "SENDING"] } } }),
        ]);
      return { messagesSent, messagesDelivered, messagesRead, messagesFailed, messagesQueued };
    },

    /** AI usage aggregate (tokens/messages) over the same period. */
    async aggregateAiUsage(
      organizationId: string,
      range: AnalyticsPeriodRange,
    ): Promise<AiUsageInput> {
      const scope = tenantWhere(organizationId);
      const period: Prisma.DateTimeFilter = { gte: range.from, lt: range.to };

      const [totals, groupedByTone, groupedByModel] = await Promise.all([
        db.aIGeneratedMessage.aggregate({
          where: { ...scope, createdAt: period },
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        db.aIGeneratedMessage.groupBy({
          by: ["tone"],
          where: { ...scope, createdAt: period },
          _count: { _all: true },
        }),
        db.aIGeneratedMessage.groupBy({
          by: ["model"],
          where: { ...scope, createdAt: period },
          _sum: { inputTokens: true, outputTokens: true },
        }),
      ]);

      const byTone: Record<string, number> = {};
      for (const row of groupedByTone) {
        byTone[row.tone as AiMessageTone] = row._count._all;
      }

      return {
        totalMessages: totals._count._all,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        byModel: groupedByModel.map((row) => ({
          model: row.model,
          inputTokens: row._sum.inputTokens ?? 0,
          outputTokens: row._sum.outputTokens ?? 0,
        })),
        byTone,
      };
    },

    /** Materialized snapshot lookup by the (tenant, period) unique key. */
    async findSnapshot(
      organizationId: string,
      range: AnalyticsPeriodRange,
    ): Promise<AnalyticsSnapshot | null> {
      return db.analyticsSnapshot.findUnique({
        where: {
          organizationId_from_to: {
            organizationId: assertOrganizationId(organizationId),
            from: range.from,
            to: range.to,
          },
        },
      });
    },

    /**
     * Persist (or recompute over) the snapshot for the period. Upsert on
     * the unique key: recomputation never duplicates rows.
     */
    async upsertSnapshot(
      organizationId: string,
      range: AnalyticsPeriodRange,
      metrics: Prisma.InputJsonValue,
      computedAt: Date,
    ): Promise<AnalyticsSnapshot> {
      const scope = assertOrganizationId(organizationId);
      return db.analyticsSnapshot.upsert({
        where: {
          organizationId_from_to: {
            organizationId: scope,
            from: range.from,
            to: range.to,
          },
        },
        update: { metrics, computedAt },
        create: {
          organizationId: scope,
          from: range.from,
          to: range.to,
          metrics,
          computedAt,
        },
      });
    },
  };
}

export const analyticsRepository = createAnalyticsRepository(prisma);
