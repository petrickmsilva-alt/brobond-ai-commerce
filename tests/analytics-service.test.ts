import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { createAnalyticsService } from "@/modules/analytics/services/analytics.service";
import { buildAnalyticsMetrics } from "@/modules/analytics/metrics/snapshot-builder";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-09-22T14:37:11.000Z");
const FROM = new Date("2026-08-24T00:00:00.000Z");
const TO = new Date("2026-09-23T00:00:00.000Z");

const saleRow = {
  quantity: 1,
  amountCents: 10_000,
  status: "PAID",
  occurredAt: "2026-09-20T10:00:00.000Z",
  productId: "p1",
  productName: "Jaqueta",
  productCostCents: 5000,
  creatorId: "c1",
  creatorName: "Ana",
  campaignId: "cp1",
  campaignName: "Inverno",
};

function fakeDb(overrides: Record<string, unknown> = {}) {
  const snapshots: Array<Record<string, unknown>> = [];
  const db = {
    sale: {
      findMany: vi.fn(async () => [
        {
          quantity: 1,
          amountCents: 10_000,
          status: "PAID",
          occurredAt: new Date("2026-09-20T10:00:00.000Z"),
          productId: "p1",
          creatorId: "c1",
          campaignId: "cp1",
          product: { name: "Jaqueta", currentCostCents: 5000 },
          creator: { displayName: "Ana" },
          campaign: { name: "Inverno" },
        },
      ]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregate: vi.fn(async (): Promise<any> => ({ _max: { updatedAt: null } })),
    },
    aIGeneratedMessage: {
      aggregate: vi.fn(async () => ({
        _count: { _all: 0 },
        _sum: { inputTokens: 0, outputTokens: 0 },
      })),
      groupBy: vi.fn(async () => []),
    },
    analyticsSnapshot: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findUnique: vi.fn(async (): Promise<any> => null),
      upsert: vi.fn(async ({ create, update, where }) => {
        const key = where.organizationId_from_to;
        const existing = snapshots.find(
          (row) =>
            row.organizationId === key.organizationId &&
            (row.from as Date).getTime() === key.from.getTime(),
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: "snap_1", ...create };
        snapshots.push(row);
        return row;
      }),
    },
    ...overrides,
  };
  return { db: db as never, dbRaw: db, snapshots };
}

describe("analytics service — PR008", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a missing organization id", async () => {
    const { db } = fakeDb();
    const service = createAnalyticsService(db);
    await expect(service.getDashboard("")).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.refresh("")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("computes + persists lazily when no snapshot exists (source=computed)", async () => {
    const { db, dbRaw } = fakeDb();
    const service = createAnalyticsService(db);
    const dashboard = await service.getDashboard("org_a", { days: 30, now: NOW });

    expect(dashboard.source).toBe("computed");
    expect(dashboard.stale).toBe(false);
    expect(dbRaw.analyticsSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(dashboard.period).toEqual({
      from: FROM.toISOString(),
      to: TO.toISOString(),
      days: 30,
    });
    expect(dashboard.metrics.totals.revenueCents).toBe(10_000);
    expect(dashboard.computedAt).toBe(NOW.toISOString());
  });

  it("serves the materialized snapshot without recomputing (source=snapshot)", async () => {
    const { db, dbRaw } = fakeDb();
    const prebuilt = buildAnalyticsMetrics(
      [saleRow],
      { totalMessages: 0, inputTokens: 0, outputTokens: 0, byModel: [], byTone: {} },
      { from: FROM.toISOString(), to: TO.toISOString(), days: 30 },
    );
    dbRaw.analyticsSnapshot.findUnique.mockResolvedValue({
      id: "snap_1",
      organizationId: "org_a",
      from: FROM,
      to: TO,
      metrics: JSON.parse(JSON.stringify(prebuilt)),
      computedAt: NOW,
    });

    const service = createAnalyticsService(db);
    const dashboard = await service.getDashboard("org_a", { days: 30, now: NOW });

    expect(dashboard.source).toBe("snapshot");
    expect(dbRaw.sale.findMany).not.toHaveBeenCalled();
    expect(dbRaw.analyticsSnapshot.upsert).not.toHaveBeenCalled();
    expect(dashboard.metrics).toEqual(prebuilt);
  });

  it("flags stale=true when sales were updated after the snapshot", async () => {
    const { db, dbRaw } = fakeDb();
    const prebuilt = buildAnalyticsMetrics(
      [saleRow],
      { totalMessages: 0, inputTokens: 0, outputTokens: 0, byModel: [], byTone: {} },
      { from: FROM.toISOString(), to: TO.toISOString(), days: 30 },
    );
    dbRaw.analyticsSnapshot.findUnique.mockResolvedValue({
      id: "snap_1",
      organizationId: "org_a",
      from: FROM,
      to: TO,
      metrics: JSON.parse(JSON.stringify(prebuilt)),
      computedAt: new Date("2026-09-21T00:00:00.000Z"),
    });
    dbRaw.sale.aggregate.mockResolvedValue({
      _max: { updatedAt: new Date("2026-09-22T08:00:00.000Z") },
    });

    const service = createAnalyticsService(db);
    const dashboard = await service.getDashboard("org_a", { days: 30, now: NOW });
    expect(dashboard.stale).toBe(true);
  });

  it("falls back to recompute when a stored snapshot fails the version guard", async () => {
    const { db, dbRaw } = fakeDb();
    dbRaw.analyticsSnapshot.findUnique.mockResolvedValue({
      id: "snap_legacy",
      organizationId: "org_a",
      from: FROM,
      to: TO,
      metrics: { version: 0, legacy: true },
      computedAt: NOW,
    });

    const service = createAnalyticsService(db);
    const dashboard = await service.getDashboard("org_a", { days: 30, now: NOW });
    expect(dashboard.source).toBe("computed");
    expect(dbRaw.analyticsSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("refresh() always recomputes and upserts even when a snapshot exists", async () => {
    const { db, dbRaw } = fakeDb();
    const prebuilt = buildAnalyticsMetrics(
      [saleRow],
      { totalMessages: 0, inputTokens: 0, outputTokens: 0, byModel: [], byTone: {} },
      { from: FROM.toISOString(), to: TO.toISOString(), days: 30 },
    );
    dbRaw.analyticsSnapshot.findUnique.mockResolvedValue({
      id: "snap_1",
      organizationId: "org_a",
      from: FROM,
      to: TO,
      metrics: JSON.parse(JSON.stringify(prebuilt)),
      computedAt: NOW,
    });

    const service = createAnalyticsService(db);
    const refreshed = await service.refresh("org_a", { days: 30, now: NOW });

    expect(refreshed.source).toBe("refreshed");
    expect(dbRaw.sale.findMany).toHaveBeenCalledTimes(1);
    expect(dbRaw.analyticsSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(refreshed.computedAt).toBe(NOW.toISOString());
  });

  it("honors the requested day count when resolving the period", async () => {
    const { db } = fakeDb();
    const service = createAnalyticsService(db);
    const dashboard = await service.getDashboard("org_a", { days: 7, now: NOW });
    expect(dashboard.period.days).toBe(7);
    expect(dashboard.period.from).toBe("2026-09-16T00:00:00.000Z");
    expect(dashboard.period.to).toBe("2026-09-23T00:00:00.000Z");
  });

  it("is deterministic: same inputs + same clock → same metrics payload", async () => {
    const { db: db1 } = fakeDb();
    const { db: db2 } = fakeDb();
    const a = await createAnalyticsService(db1).getDashboard("org_a", { days: 30, now: NOW });
    const b = await createAnalyticsService(db2).getDashboard("org_a", { days: 30, now: NOW });
    expect(a.metrics).toEqual(b.metrics);
  });
});
