import { describe, expect, it } from "vitest";
import {
  ANALYTICS_SNAPSHOT_VERSION,
  buildAnalyticsMetrics,
  readAnalyticsMetrics,
  resolvePeriodDays,
  toAnalyticsPeriod,
  type AiUsageInput,
  type SnapshotSaleInput,
} from "@/modules/analytics/metrics/snapshot-builder";

const emptyAi: AiUsageInput = {
  totalMessages: 0,
  inputTokens: 0,
  outputTokens: 0,
  byModel: [],
  byTone: {},
};

const period = { from: "2026-08-25T00:00:00.000Z", to: "2026-09-24T00:00:00.000Z", days: 30 };

const sales: SnapshotSaleInput[] = [
  {
    quantity: 2,
    amountCents: 59_800,
    status: "PAID",
    occurredAt: "2026-09-20T10:00:00.000Z",
    productId: "p1",
    productName: "Jaqueta Bomber",
    productCostCents: 20_000,
    creatorId: "c1",
    creatorName: "Ana",
    campaignId: "cp1",
    campaignName: "Inverno",
  },
  {
    quantity: 1,
    amountCents: 9900,
    status: "PAID",
    occurredAt: "2026-09-21T10:00:00.000Z",
    productId: "p2",
    productName: "Tênis Street",
    productCostCents: 4000,
    creatorId: null,
    creatorName: null,
    campaignId: "cp1",
    campaignName: "Inverno",
  },
  {
    quantity: 1,
    amountCents: 5000,
    status: "PENDING",
    occurredAt: "2026-09-22T10:00:00.000Z",
    productId: "p1",
    productName: "Jaqueta Bomber",
    productCostCents: 20_000,
    creatorId: "c1",
    creatorName: "Ana",
    campaignId: "cp1",
    campaignName: "Inverno",
  },
];

describe("buildAnalyticsMetrics() — PR008", () => {
  it("produces the complete versioned payload", () => {
    const metrics = buildAnalyticsMetrics(sales, emptyAi, period);
    expect(metrics.version).toBe(ANALYTICS_SNAPSHOT_VERSION);
    expect(metrics.period).toEqual(period);
    expect(metrics.totals.revenueCents).toBe(59_800 + 9900);
    expect(metrics.totals.paidCount).toBe(2);
    expect(metrics.totals.pendingCount).toBe(1);
    expect(metrics.roiBps).toBe(metrics.totals.grossMarginBps);
    expect(metrics.attribution.byProduct).toHaveLength(2);
    expect(metrics.attribution.byCreator).toHaveLength(2); // Ana + un-attributed
    expect(metrics.attribution.byCampaign).toHaveLength(1);
    expect(metrics.ai).toEqual({
      totalMessages: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsdCents: 0,
      byTone: {},
    });
  });

  it("is byte-identical for the same rows in any order (JSON-stable)", () => {
    const a = buildAnalyticsMetrics(sales, emptyAi, period);
    const b = buildAnalyticsMetrics([...sales].reverse(), emptyAi, period);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is JSON round-trip safe (Prisma Json compatible)", () => {
    const metrics = buildAnalyticsMetrics(sales, emptyAi, period);
    expect(JSON.parse(JSON.stringify(metrics))).toEqual(metrics);
  });

  it("estimates AI cost per model from the period aggregates", () => {
    const metrics = buildAnalyticsMetrics(
      sales,
      {
        totalMessages: 3,
        inputTokens: 3000,
        outputTokens: 1500,
        byModel: [
          { model: "gpt-4o-mini", inputTokens: 3000, outputTokens: 1500 },
          { model: "unknown-model", inputTokens: 0, outputTokens: 0 },
        ],
        byTone: { FRIENDLY: 2, LUXURY: 1 },
      },
      period,
    );
    expect(metrics.ai.estimatedCostUsdCents).toBeGreaterThan(0);
    expect(metrics.ai.totalMessages).toBe(3);
    expect(metrics.ai.byTone).toEqual({ FRIENDLY: 2, LUXURY: 1 });
  });

  it("aggregates un-attributed sales without losing revenue", () => {
    const metrics = buildAnalyticsMetrics(
      [
        {
          quantity: 1,
          amountCents: 1000,
          status: "PAID",
          occurredAt: "2026-09-20T10:00:00.000Z",
          productId: null,
          productName: null,
          productCostCents: null,
          creatorId: null,
          creatorName: null,
          campaignId: null,
          campaignName: null,
        },
      ],
      emptyAi,
      period,
    );
    expect(metrics.totals.revenueCents).toBe(1000);
    expect(metrics.attribution.byProduct[0]?.key).toBe("__unattributed__");
    expect(metrics.totals.revenueWithUnknownCostCents).toBe(1000);
  });

  it("handles the empty-period case without NaN or division errors", () => {
    const metrics = buildAnalyticsMetrics([], emptyAi, period);
    expect(metrics.totals.revenueCents).toBe(0);
    expect(metrics.totals.grossMarginBps).toBe(0);
    expect(metrics.roiBps).toBe(0);
    expect(metrics.attribution.byProduct).toEqual([]);
    expect(metrics.ai.estimatedCostUsdCents).toBe(0);
  });
});

describe("readAnalyticsMetrics() — PR008", () => {
  it("round-trips a built payload", () => {
    const metrics = buildAnalyticsMetrics(sales, emptyAi, period);
    expect(readAnalyticsMetrics(JSON.parse(JSON.stringify(metrics)))).toEqual(metrics);
  });

  it("rejects non-objects and null", () => {
    expect(readAnalyticsMetrics(null)).toBeNull();
    expect(readAnalyticsMetrics("nope")).toBeNull();
    expect(readAnalyticsMetrics(42)).toBeNull();
  });

  it("rejects foreign/legacy versions", () => {
    const metrics = buildAnalyticsMetrics(sales, emptyAi, period);
    expect(readAnalyticsMetrics({ ...metrics, version: 0 })).toBeNull();
    expect(readAnalyticsMetrics({ ...metrics, version: 999 })).toBeNull();
  });

  it("rejects payloads missing a top-level block", () => {
    const metrics = buildAnalyticsMetrics(sales, emptyAi, period) as unknown as Record<
      string,
      unknown
    >;
    const { attribution: _omit, ...rest } = metrics;
    expect(readAnalyticsMetrics(rest)).toBeNull();
  });
});

describe("resolvePeriodDays() — PR008", () => {
  const now = new Date("2026-09-22T14:37:11.000Z");

  it("builds a half-open, day-normalized UTC period including today", () => {
    const { from, to } = resolvePeriodDays(30, now);
    expect(to.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(from.toISOString()).toBe("2026-08-24T00:00:00.000Z");
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(30);
  });

  it("respects the day count exactly", () => {
    expect(
      (resolvePeriodDays(7, now).to.getTime() - resolvePeriodDays(7, now).from.getTime()) /
        86_400_000,
    ).toBe(7);
    expect(
      (resolvePeriodDays(90, now).to.getTime() - resolvePeriodDays(90, now).from.getTime()) /
        86_400_000,
    ).toBe(90);
  });

  it("is deterministic for the same clock input", () => {
    expect(resolvePeriodDays(30, now)).toEqual(resolvePeriodDays(30, now));
  });

  it("serializes via toAnalyticsPeriod with the day count", () => {
    const { from, to } = resolvePeriodDays(7, now);
    expect(toAnalyticsPeriod(from, to, 7)).toEqual({
      from: "2026-09-16T00:00:00.000Z",
      to: "2026-09-23T00:00:00.000Z",
      days: 7,
    });
  });
});
