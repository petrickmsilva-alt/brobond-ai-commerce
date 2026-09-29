import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR010.1 — Dashboard overview read model tests.
 *
 * `lib/dashboard-overview.ts` is the only new file in this UI PR that shapes
 * numbers, so it is pinned hard:
 *
 *   - tenant scope is injected into EVERY query (multi-tenancy §3);
 *   - monetary figures are read from the PR008 analytics pipeline verbatim —
 *     no metric is recomputed or redefined here;
 *   - the daily series is gap-free and counts only PAID sales;
 *   - an unscoped call is rejected before it reaches the database.
 */

/**
 * Prisma is mocked with explicitly-typed argument tuples: `vi.fn(async () => …)`
 * would infer a zero-arity signature and make every `mock.calls[0][0]`
 * assertion below a type error.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = (args: any) => Promise<any>;

const analyticsGetDashboard = vi.fn<(...args: unknown[]) => Promise<unknown>>();

const prismaMock = {
  product: { count: vi.fn<AnyArgs>(async () => 12) },
  creatorProfile: {
    count: vi.fn<AnyArgs>(async () => 34),
    groupBy: vi.fn<AnyArgs>(async () => [
      { status: "DISCOVERED", _count: { _all: 20 } },
      { status: "ACTIVE", _count: { _all: 9 } },
      { status: "REJECTED", _count: { _all: 0 } },
      { status: "CONTACTED", _count: { _all: 5 } },
    ]),
  },
  campaign: { count: vi.fn<AnyArgs>(async () => 3) },
  sale: { findMany: vi.fn<AnyArgs>(async () => [] as unknown[]) },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/modules/analytics/services/analytics.service", () => ({
  analyticsService: { getDashboard: (...args: unknown[]) => analyticsGetDashboard(...args) },
}));

const { getDashboardOverview } = await import("@/lib/dashboard-overview");

const ORG = "org_alpha";
const OTHER_ORG = "org_beta";
const NOW = new Date("2026-09-23T14:37:11.000Z");

function analyticsPayload(overrides: Record<string, unknown> = {}) {
  return {
    period: { from: "2026-08-25T00:00:00.000Z", to: "2026-09-24T00:00:00.000Z", days: 30 },
    computedAt: "2026-09-23T14:00:00.000Z",
    stale: false,
    source: "snapshot",
    metrics: {
      version: 1,
      period: { from: "2026-08-25T00:00:00.000Z", to: "2026-09-24T00:00:00.000Z", days: 30 },
      totals: {
        revenueCents: 250_000,
        unitsSold: 40,
        paidCount: 30,
        pendingCount: 10,
        refundedCount: 0,
        refundedCents: 0,
        cancelledCount: 0,
        costCents: 100_000,
        revenueWithUnknownCostCents: 0,
        grossMarginCents: 150_000,
        grossMarginBps: 6000,
        avgTicketCents: 8_333,
      },
      roiBps: 6000,
      attribution: {
        byProduct: Array.from({ length: 9 }, (_, index) => ({
          key: `p${index}`,
          label: `Produto ${index}`,
          revenueCents: 1000 * (9 - index),
          salesCount: 1,
          unitsSold: 1,
          shareBps: 100,
        })),
        byCreator: Array.from({ length: 8 }, (_, index) => ({
          key: `c${index}`,
          label: `Creator ${index}`,
          revenueCents: 500 * (8 - index),
          salesCount: 1,
          unitsSold: 1,
          shareBps: 100,
        })),
        byCampaign: [],
      },
      ai: {
        totalMessages: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsdCents: 0,
        byTone: {},
      },
      delivery: {
        messagesSent: 0,
        messagesDelivered: 0,
        messagesRead: 0,
        messagesFailed: 0,
        messagesQueued: 0,
        deliveryRate: 0,
        readRate: 0,
      },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  analyticsGetDashboard.mockResolvedValue(analyticsPayload());
  prismaMock.sale.findMany.mockResolvedValue([]);
  prismaMock.product.count.mockResolvedValue(12);
  prismaMock.creatorProfile.count.mockResolvedValue(34);
  prismaMock.campaign.count.mockResolvedValue(3);
});

describe("dashboard overview — tenant isolation", () => {
  it("scopes every Prisma query to the caller's organization", async () => {
    await getDashboardOverview(ORG, { now: NOW });

    expect(prismaMock.product.count).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
    expect(prismaMock.creatorProfile.count).toHaveBeenCalledWith({
      where: { organizationId: ORG },
    });
    expect(prismaMock.creatorProfile.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
    for (const call of prismaMock.campaign.count.mock.calls) {
      expect(call[0].where.organizationId).toBe(ORG);
    }
  });

  it("scopes Sale by its direct tenant FK (PR011.1)", async () => {
    await getDashboardOverview(ORG, { now: NOW });

    const where = prismaMock.sale.findMany.mock.calls[0]![0].where;
    expect(where.AND[0]).toEqual({ organizationId: ORG });
  });

  it("forwards the tenant to the analytics pipeline", async () => {
    await getDashboardOverview(ORG, { now: NOW });
    expect(analyticsGetDashboard).toHaveBeenCalledWith(ORG, { days: 30, now: NOW });
  });

  it("never leaks another tenant's id into a query", async () => {
    await getDashboardOverview(ORG, { now: NOW });
    const serialized = JSON.stringify([
      prismaMock.product.count.mock.calls,
      prismaMock.sale.findMany.mock.calls,
      prismaMock.campaign.count.mock.calls,
    ]);
    expect(serialized).not.toContain(OTHER_ORG);
  });

  it("rejects an empty organization id before touching the database", async () => {
    await expect(getDashboardOverview("", { now: NOW })).rejects.toThrow();
    expect(prismaMock.sale.findMany).not.toHaveBeenCalled();
  });
});

describe("dashboard overview — metrics are READ, never redefined", () => {
  it("passes the analytics totals straight through", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW });

    expect(overview.gmvCents).toBe(250_000);
    expect(overview.orders).toBe(30);
    expect(overview.avgTicketCents).toBe(8_333);
    expect(overview.grossMarginCents).toBe(150_000);
    expect(overview.roiBps).toBe(6000);
  });

  it("derives conversion as PAID ÷ (PAID + PENDING) in basis points", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW });
    // 30 / (30 + 10) = 75%
    expect(overview.conversionBps).toBe(7500);
  });

  it("reports zero conversion when the pipeline is empty (no division by zero)", async () => {
    const payload = analyticsPayload();
    payload.metrics.totals.paidCount = 0;
    payload.metrics.totals.pendingCount = 0;
    analyticsGetDashboard.mockResolvedValue(payload);

    const overview = await getDashboardOverview(ORG, { now: NOW });
    expect(overview.conversionBps).toBe(0);
    expect(Number.isNaN(overview.conversionBps)).toBe(false);
  });

  it("propagates the snapshot staleness flag", async () => {
    analyticsGetDashboard.mockResolvedValue(analyticsPayload({ stale: true }));
    const overview = await getDashboardOverview(ORG, { now: NOW });
    expect(overview.stale).toBe(true);
  });

  it("truncates the attribution rankings to six rows, keeping the pipeline's order", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW });

    expect(overview.topProducts).toHaveLength(6);
    expect(overview.topCreators).toHaveLength(6);
    expect(overview.topProducts[0]!.label).toBe("Produto 0");
    expect(overview.topCreators[0]!.label).toBe("Creator 0");
  });
});

describe("dashboard overview — daily series", () => {
  it("emits one gap-free point per day of the period", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW, days: 7 });

    expect(overview.daily).toHaveLength(7);
    expect(overview.daily.every((point) => typeof point.date === "string")).toBe(true);
    expect(overview.daily.at(-1)!.date).toBe("23/09");
  });

  it("zero-fills days without sales instead of dropping them", async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { amountCents: 5_000, status: "PAID", occurredAt: new Date("2026-09-23T09:00:00.000Z") },
    ]);

    const overview = await getDashboardOverview(ORG, { now: NOW, days: 3 });

    expect(overview.daily).toHaveLength(3);
    expect(overview.daily[0]).toEqual({ date: "21/09", gmvCents: 0, orders: 0 });
    expect(overview.daily[2]).toEqual({ date: "23/09", gmvCents: 5_000, orders: 1 });
  });

  it("counts ONLY paid sales — the PR008 revenue convention is preserved", async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { amountCents: 5_000, status: "PAID", occurredAt: new Date("2026-09-23T09:00:00.000Z") },
      { amountCents: 9_900, status: "PENDING", occurredAt: new Date("2026-09-23T10:00:00.000Z") },
      { amountCents: 7_700, status: "REFUNDED", occurredAt: new Date("2026-09-23T11:00:00.000Z") },
      { amountCents: 4_400, status: "CANCELLED", occurredAt: new Date("2026-09-23T12:00:00.000Z") },
    ]);

    const overview = await getDashboardOverview(ORG, { now: NOW, days: 1 });

    expect(overview.daily[0]).toEqual({ date: "23/09", gmvCents: 5_000, orders: 1 });
  });

  it("accumulates multiple paid sales on the same day", async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { amountCents: 1_000, status: "PAID", occurredAt: new Date("2026-09-23T09:00:00.000Z") },
      { amountCents: 2_500, status: "PAID", occurredAt: new Date("2026-09-23T18:00:00.000Z") },
    ]);

    const overview = await getDashboardOverview(ORG, { now: NOW, days: 1 });

    expect(overview.daily[0]).toEqual({ date: "23/09", gmvCents: 3_500, orders: 2 });
  });

  it("ignores sales that fall outside the requested window", async () => {
    prismaMock.sale.findMany.mockResolvedValue([
      { amountCents: 9_000, status: "PAID", occurredAt: new Date("2025-01-01T09:00:00.000Z") },
    ]);

    const overview = await getDashboardOverview(ORG, { now: NOW, days: 2 });

    expect(overview.daily.every((point) => point.gmvCents === 0)).toBe(true);
  });
});

describe("dashboard overview — counters and creator funnel", () => {
  it("returns the tenant entity counters", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW });

    expect(overview.counts.products).toBe(12);
    expect(overview.counts.creators).toBe(34);
    expect(overview.counts.activeCampaigns).toBe(3);
    expect(overview.counts.totalCampaigns).toBe(3);
  });

  it("counts live campaigns as RUNNING or SCHEDULED", async () => {
    await getDashboardOverview(ORG, { now: NOW });

    const scoped = prismaMock.campaign.count.mock.calls.find((call) => call[0].where.status);
    expect(scoped![0].where.status.in).toEqual(["RUNNING", "SCHEDULED"]);
  });

  it("labels the creator funnel in pt-BR, drops empty stages and ranks by size", async () => {
    const overview = await getDashboardOverview(ORG, { now: NOW });

    expect(overview.creatorFunnel).toEqual([
      { label: "Descobertos", value: 20 },
      { label: "Ativos", value: 9 },
      { label: "Contatados", value: 5 },
    ]);
  });

  it("falls back to the raw status when no pt-BR label is known", async () => {
    prismaMock.creatorProfile.groupBy.mockResolvedValue([
      { status: "SOME_FUTURE_STATUS", _count: { _all: 2 } },
    ]);

    const overview = await getDashboardOverview(ORG, { now: NOW });
    expect(overview.creatorFunnel).toEqual([{ label: "SOME_FUTURE_STATUS", value: 2 }]);
  });

  it("returns an empty funnel for a tenant with no creators", async () => {
    prismaMock.creatorProfile.groupBy.mockResolvedValue([]);
    const overview = await getDashboardOverview(ORG, { now: NOW });
    expect(overview.creatorFunnel).toEqual([]);
  });
});
