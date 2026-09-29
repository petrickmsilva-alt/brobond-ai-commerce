import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { createAnalyticsRepository } from "@/modules/analytics/repositories/analytics.repository";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const from = new Date("2026-08-24T00:00:00.000Z");
const to = new Date("2026-09-23T00:00:00.000Z");
const computedAt = new Date("2026-09-22T12:00:00.000Z");

function fakeDb() {
  const sale = {
    findMany: vi.fn(async () => [
      {
        quantity: 2,
        amountCents: 59_800,
        status: "PAID",
        occurredAt: new Date("2026-09-20T10:00:00.000Z"),
        productId: "p1",
        creatorId: "c1",
        campaignId: "cp1",
        product: { name: "Jaqueta", currentCostCents: 20_000 },
        creator: { displayName: "Ana" },
        campaign: { name: "Inverno" },
      },
      {
        quantity: 1,
        amountCents: 1000,
        status: "PAID",
        occurredAt: new Date("2026-09-21T10:00:00.000Z"),
        productId: null,
        creatorId: null,
        campaignId: null,
        product: null,
        creator: null,
        campaign: null,
      },
    ]),
    aggregate: vi.fn(async () => ({ _max: { updatedAt: new Date("2026-09-22T00:00:00.000Z") } })),
  };
  const aIGeneratedMessage = {
    aggregate: vi.fn(async () => ({
      _count: { _all: 3 },
      _sum: { inputTokens: 300, outputTokens: 150 },
    })),
    groupBy: vi.fn(async ({ by }: { by: string[] }) =>
      by.includes("tone")
        ? [
            { tone: "FRIENDLY", _count: { _all: 2 } },
            { tone: "LUXURY", _count: { _all: 1 } },
          ]
        : [{ model: "gpt-4o-mini", _sum: { inputTokens: 300, outputTokens: 150 } }],
    ),
  };
  const snapshots: Array<Record<string, unknown>> = [];
  const analyticsSnapshot = {
    findUnique: vi.fn(async ({ where }) => {
      const key = where.organizationId_from_to;
      return (
        snapshots.find(
          (row) =>
            row.organizationId === key.organizationId &&
            (row.from as Date).getTime() === key.from.getTime() &&
            (row.to as Date).getTime() === key.to.getTime(),
        ) ?? null
      );
    }),
    upsert: vi.fn(async ({ where, update, create }) => {
      const key = where.organizationId_from_to;
      const existing = snapshots.findIndex(
        (row) =>
          row.organizationId === key.organizationId &&
          (row.from as Date).getTime() === key.from.getTime() &&
          (row.to as Date).getTime() === key.to.getTime(),
      );
      if (existing >= 0) {
        snapshots[existing] = { ...snapshots[existing], ...update };
        return snapshots[existing];
      }
      snapshots.push({ id: `snap_${snapshots.length}`, ...create });
      return snapshots[snapshots.length - 1];
    }),
  };
  return {
    db: { sale, aIGeneratedMessage, analyticsSnapshot } as never,
    sale,
    aIGeneratedMessage,
    analyticsSnapshot,
    snapshots,
  };
}

describe("analytics repository — PR008", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createAnalyticsRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createAnalyticsRepository(fake.db);
  });

  it("listSalesForPeriod scopes by tenant AND the half-open period", async () => {
    await repository.listSalesForPeriod("org_a", { from, to });
    expect(fake.sale.findMany).toHaveBeenCalledTimes(1);
    expect(fake.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ organizationId: "org_a" }, { occurredAt: { gte: from, lt: to } }],
        },
      }),
    );
  });

  it("listSalesForPeriod projects rows with attribution fallbacks for SetNull relations", async () => {
    const rows = await repository.listSalesForPeriod("org_a", { from, to });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      status: "PAID",
      productName: "Jaqueta",
      productCostCents: 20_000,
      creatorName: "Ana",
      campaignName: "Inverno",
    });
    expect(rows[1]).toMatchObject({
      productId: null,
      productName: null,
      creatorName: null,
      campaignName: null,
      productCostCents: null,
    });
    expect(typeof rows[0]?.occurredAt).toBe("string");
  });

  it("rejects a missing organization id on every method", async () => {
    await expect(repository.listSalesForPeriod("", { from, to })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(repository.maxSaleUpdatedAt("", { from, to })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(repository.findSnapshot("", { from, to })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await expect(
      repository.upsertSnapshot("", { from, to }, {} as never, computedAt),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("maxSaleUpdatedAt returns the newest updatedAt within tenant+period", async () => {
    const result = await repository.maxSaleUpdatedAt("org_a", { from, to });
    expect(result?.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(fake.sale.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [expect.anything(), { occurredAt: { gte: from, lt: to } }],
        }),
      }),
    );
  });

  it("aggregateAiUsage groups by tone and model within tenant+period", async () => {
    const usage = await repository.aggregateAiUsage("org_a", { from, to });
    expect(usage.totalMessages).toBe(3);
    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(150);
    expect(usage.byTone).toEqual({ FRIENDLY: 2, LUXURY: 1 });
    expect(usage.byModel).toEqual([{ model: "gpt-4o-mini", inputTokens: 300, outputTokens: 150 }]);
  });

  it("aggregateAiUsage scopes queries to the tenant", async () => {
    await repository.aggregateAiUsage("org_a", { from, to });
    expect(fake.aIGeneratedMessage.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_a",
          createdAt: { gte: from, lt: to },
        }),
      }),
    );
  });

  it("findSnapshot looks up by the (tenant, from, to) unique key", async () => {
    fake.analyticsSnapshot.upsert({
      where: { organizationId_from_to: { organizationId: "org_a", from, to } },
      update: {},
      create: { organizationId: "org_a", from, to, metrics: {}, computedAt },
    } as never);
    const found = await repository.findSnapshot("org_a", { from, to });
    expect(found).not.toBeNull();
    expect(await repository.findSnapshot("org_b", { from, to })).toBeNull();
  });

  it("upsertSnapshot creates then updates the same unique key (recompute never duplicates)", async () => {
    await repository.upsertSnapshot("org_a", { from, to }, { v: 1 } as never, computedAt);
    await repository.upsertSnapshot("org_a", { from, to }, { v: 2 } as never, computedAt);
    expect(fake.snapshots).toHaveLength(1);
    expect(fake.snapshots[0]).toMatchObject({ organizationId: "org_a", metrics: { v: 2 } });
  });

  it("upsertSnapshot separates tenants on the same period", async () => {
    await repository.upsertSnapshot("org_a", { from, to }, { v: 1 } as never, computedAt);
    await repository.upsertSnapshot("org_b", { from, to }, { v: 9 } as never, computedAt);
    expect(fake.snapshots).toHaveLength(2);
  });
});
