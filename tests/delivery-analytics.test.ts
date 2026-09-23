// PR010 §11 — Delivery analytics: additive `delivery` section on the
// AnalyticsSnapshot metrics (messagesSent/messagesDelivered/messagesRead/
// deliveryRate/readRate), zero-baseline backfill for old snapshots, and the
// tenant-scoped repository aggregate.
import { describe, expect, it } from "vitest";
import { DeliveryChannel, DeliveryStatus } from "@prisma/client";
import {
  ANALYTICS_SNAPSHOT_VERSION,
  ZERO_DELIVERY_USAGE,
  buildAnalyticsMetrics,
  buildDeliveryMetrics,
  rateBps,
  readAnalyticsMetrics,
  toAnalyticsPeriod,
} from "@/modules/analytics/metrics/snapshot-builder";
import { createAnalyticsRepository } from "@/modules/analytics/repositories/analytics.repository";

const PERIOD = toAnalyticsPeriod(
  new Date("2026-09-01T00:00:00.000Z"),
  new Date("2026-09-16T00:00:00.000Z"),
  15,
);

const AI_EMPTY = {
  totalMessages: 0,
  inputTokens: 0,
  outputTokens: 0,
  byModel: [],
  byTone: {},
};

function deliveryUsage(overrides: Partial<typeof ZERO_DELIVERY_USAGE> = {}) {
  return { ...ZERO_DELIVERY_USAGE, ...overrides };
}

describe("delivery metrics · rates", () => {
  it("computes deliveryRate over sent and readRate over delivered (bps)", () => {
    const metrics = buildDeliveryMetrics(
      deliveryUsage({ messagesSent: 10, messagesDelivered: 8, messagesRead: 4 }),
    );
    expect(metrics.deliveryRate).toBe(8000);
    expect(metrics.readRate).toBe(5000);
    expect(metrics.messagesSent).toBe(10);
  });

  it("rounds rates to integer basis points", () => {
    expect(rateBps(1, 3)).toBe(3333);
    expect(rateBps(2, 3)).toBe(6667);
    expect(rateBps(1, 0)).toBe(0);
    expect(rateBps(0, 10)).toBe(0);
  });

  it("zero denominators never divide by zero", () => {
    const metrics = buildDeliveryMetrics(deliveryUsage());
    expect(metrics.deliveryRate).toBe(0);
    expect(metrics.readRate).toBe(0);
    expect(metrics.messagesQueued).toBe(0);
  });
});

describe("delivery metrics · snapshot builder", () => {
  it("deliveryUsage extends buildAnalyticsMetrics additively", () => {
    const metrics = buildAnalyticsMetrics(
      [],
      AI_EMPTY,
      PERIOD,
      deliveryUsage({
        messagesSent: 5,
        messagesDelivered: 4,
        messagesRead: 2,
        messagesFailed: 1,
        messagesQueued: 3,
      }),
    );
    expect(metrics.version).toBe(ANALYTICS_SNAPSHOT_VERSION);
    expect(metrics.delivery).toEqual({
      messagesSent: 5,
      messagesDelivered: 4,
      messagesRead: 2,
      messagesFailed: 1,
      messagesQueued: 3,
      deliveryRate: 8000,
      readRate: 5000,
    });
    // The pre-PR010 sections survive untouched.
    expect(metrics.totals).toBeDefined();
    expect(metrics.ai).toBeDefined();
    expect(metrics.attribution).toBeDefined();
  });

  it("omitting deliveryUsage produces the zero baseline", () => {
    const metrics = buildAnalyticsMetrics([], AI_EMPTY, PERIOD);
    expect(metrics.delivery).toEqual({
      messagesSent: 0,
      messagesDelivered: 0,
      messagesRead: 0,
      messagesFailed: 0,
      messagesQueued: 0,
      deliveryRate: 0,
      readRate: 0,
    });
  });

  it("the same inputs produce byte-identical metrics", () => {
    const usage = deliveryUsage({ messagesSent: 2, messagesDelivered: 1 });
    expect(buildAnalyticsMetrics([], AI_EMPTY, PERIOD, usage)).toEqual(
      buildAnalyticsMetrics([], AI_EMPTY, PERIOD, usage),
    );
  });
});

describe("delivery metrics · snapshot reader backfill", () => {
  function roundTrip(overrides: Record<string, unknown> = {}) {
    const metrics = buildAnalyticsMetrics(
      [],
      AI_EMPTY,
      PERIOD,
      deliveryUsage({ messagesSent: 7, messagesDelivered: 7, messagesRead: 7 }),
    );
    return readAnalyticsMetrics({ ...metrics, ...overrides });
  }

  it("reads current snapshots with the delivery section intact", () => {
    const parsed = roundTrip();
    expect(parsed?.delivery.messagesSent).toBe(7);
    expect(parsed?.delivery.readRate).toBe(10000);
  });

  it("BACKFILL: a pre-PR010 snapshot without `delivery` gets zeros — never null", () => {
    const legacy = roundTrip({ delivery: undefined });
    expect(legacy).not.toBeNull();
    expect(legacy?.delivery).toEqual(buildDeliveryMetrics(ZERO_DELIVERY_USAGE));
  });

  it("BACKFILL: a null `delivery` key also gets the zero baseline", () => {
    const legacy = roundTrip({ delivery: null });
    expect(legacy?.delivery.messagesSent).toBe(0);
  });

  it("reject-garbage behavior is preserved for broken payloads", () => {
    expect(readAnalyticsMetrics({})).toBeNull();
    expect(readAnalyticsMetrics("nope")).toBeNull();
    expect(readAnalyticsMetrics(null)).toBeNull();
  });
});

describe("delivery metrics · repository aggregate", () => {
  function fakeDb(organizationId = "org_a") {
    const scope = (org: string, status?: DeliveryStatus) => ({
      organizationId: org,
      status: status ?? DeliveryStatus.SENT,
    });
    const rows = [
      {
        ...scope("org_a"),
        sentAt: new Date("2026-09-02T10:00:00Z"),
        deliveredAt: null,
        readAt: null,
      },
      {
        ...scope("org_a"),
        sentAt: new Date("2026-09-03T10:00:00Z"),
        deliveredAt: new Date("2026-09-03T12:00:00Z"),
        readAt: null,
      },
      {
        ...scope("org_a"),
        sentAt: new Date("2026-09-04T10:00:00Z"),
        deliveredAt: new Date("2026-09-04T11:00:00Z"),
        readAt: new Date("2026-09-05T09:00:00Z"),
      },
      {
        ...scope("org_a", DeliveryStatus.FAILED),
        status: DeliveryStatus.FAILED,
        updatedAt: new Date("2026-09-06T09:00:00Z"),
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      },
      { ...scope("org_a", DeliveryStatus.QUEUED), sentAt: null, deliveredAt: null, readAt: null },
      // Outside the period (before `from`): ignored by every receipt metric.
      {
        ...scope("org_a"),
        sentAt: new Date("2026-08-01T10:00:00Z"),
        deliveredAt: null,
        readAt: null,
      },
      // Another tenant: invisible.
      {
        ...scope("org_b"),
        sentAt: new Date("2026-09-02T10:00:00Z"),
        deliveredAt: null,
        readAt: null,
      },
    ];
    return {
      deliveryMessage: {
        async count({ where }: { where: Record<string, unknown> }) {
          return rows.filter((row) => {
            if (row.organizationId !== (where.organizationId as string)) return false;
            const statusFilter = where.status as { in?: string[] } | string | undefined;
            if (typeof statusFilter === "string" && row.status !== statusFilter) return false;
            if (
              typeof statusFilter === "object" &&
              statusFilter?.in &&
              !statusFilter.in.includes(row.status)
            )
              return false;
            for (const key of ["sentAt", "deliveredAt", "readAt", "updatedAt"] as const) {
              const range = where[key] as { gte?: Date; lt?: Date } | undefined;
              if (!range) continue;
              const value = (row as Record<string, unknown>)[key];
              if (!(value instanceof Date)) return false;
              if (range.gte && value < range.gte) return false;
              if (range.lt && value >= range.lt) return false;
            }
            return true;
          }).length;
        },
      },
    };
  }

  const RANGE = {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-16T00:00:00.000Z"),
  };

  it("counts receipts by their own timestamps, tenant-scoped", async () => {
    const repo = createAnalyticsRepository(fakeDb() as never);
    const usage = await repo.aggregateDeliveryUsage("org_a", RANGE);
    expect(usage).toEqual({
      messagesSent: 3,
      messagesDelivered: 2,
      messagesRead: 1,
      messagesFailed: 1,
      messagesQueued: 1,
    });
  });

  it("other tenants are invisible to the aggregate", async () => {
    const repo = createAnalyticsRepository(fakeDb() as never);
    const usage = await repo.aggregateDeliveryUsage("org_b", RANGE);
    expect(usage.messagesSent).toBe(1);
    expect(usage.messagesDelivered).toBe(0);
    expect(usage.messagesQueued).toBe(0);
  });

  it("falls back to the zero baseline when the delivery model is absent", async () => {
    const repo = createAnalyticsRepository({} as never);
    const usage = await repo.aggregateDeliveryUsage("org_a", RANGE);
    expect(usage).toEqual(ZERO_DELIVERY_USAGE);
  });

  it("a blank tenant is rejected", async () => {
    const repo = createAnalyticsRepository(fakeDb() as never);
    await expect(repo.aggregateDeliveryUsage("  ", RANGE)).rejects.toThrow();
  });
});

describe("delivery metrics · channel sanity", () => {
  it("the delivery enums expose exactly the two contracted channels", () => {
    expect(DeliveryChannel.INSTAGRAM).toBe("INSTAGRAM");
    expect(DeliveryChannel.WHATSAPP).toBe("WHATSAPP");
  });
});
