import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { createAiMessageRepository } from "@/modules/ai/repositories/ai-message.repository";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeDb() {
  const rows: Array<Record<string, any>> = [];
  const matches = (row: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);

  const aIGeneratedMessage = {
    create: vi.fn(async ({ data }) => {
      const row = {
        id: `m${rows.length + 1}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }) => {
      const { organizationId, contextHash } = where.organizationId_contextHash;
      return (
        rows.find(
          (row) => row.organizationId === organizationId && row.contextHash === contextHash,
        ) ?? null
      );
    }),
    findFirst: vi.fn(async ({ where }) => rows.find((row) => matches(row, where)) ?? null),
    findMany: vi.fn(async ({ where, skip = 0, take }) => {
      const filtered = rows.filter((row) => matches(row, where));
      return take ? filtered.slice(skip, skip + take) : filtered.slice(skip);
    }),
    count: vi.fn(async ({ where }) => rows.filter((row) => matches(row, where)).length),
    aggregate: vi.fn(async ({ where }) => {
      const filtered = rows.filter((row) => matches(row, where));
      return {
        _count: { _all: filtered.length },
        _sum: {
          inputTokens: filtered.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
          outputTokens: filtered.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
        },
      };
    }),
    groupBy: vi.fn(async ({ where }) => {
      const filtered = rows.filter((row) => matches(row, where));
      const counts = new Map<string, number>();
      filtered.forEach((row) => counts.set(row.tone, (counts.get(row.tone) ?? 0) + 1));
      return [...counts].map(([tone, count]) => ({ tone, _count: { _all: count } }));
    }),
  };
  return { db: { aIGeneratedMessage }, rows, aIGeneratedMessage };
}

const baseData = {
  creatorProfileId: "creator_1",
  productId: "product_1",
  campaignId: "campaign_1",
  tone: "FRIENDLY" as const,
  promptVersion: "friendly@1.0.0",
  contextHash: "hash-a",
  model: "gpt-4o-mini",
  temperature: 0.7,
  inputTokens: 100,
  outputTokens: 50,
  content: { title: "t", message: "m", hashtags: ["#a"], cta: "c" },
};

describe("AI message repository", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createAiMessageRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createAiMessageRepository(fake.db as never);
  });

  it("creates a tenant-scoped record", async () => {
    const row = await repository.create("org_a", baseData);
    expect(row).toMatchObject({ organizationId: "org_a", tone: "FRIENDLY" });
  });

  it("rejects a missing organization id", async () => {
    await expect(repository.create("", baseData)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(repository.findByContextHash("", "hash-a")).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("finds a cached message by (organizationId, contextHash)", async () => {
    await repository.create("org_a", baseData);
    const found = await repository.findByContextHash("org_a", "hash-a");
    expect(found).not.toBeNull();
    expect(found?.contextHash).toBe("hash-a");
  });

  it("returns null on a cache miss", async () => {
    await repository.create("org_a", baseData);
    expect(await repository.findByContextHash("org_a", "hash-b")).toBeNull();
  });

  it("does not leak a cached message across tenants", async () => {
    await repository.create("org_a", baseData);
    expect(await repository.findByContextHash("org_b", "hash-a")).toBeNull();
  });

  it("finds a message by id scoped to the tenant", async () => {
    const created = await repository.create("org_a", baseData);
    expect(await repository.findById("org_a", created.id)).not.toBeNull();
    expect(await repository.findById("org_b", created.id)).toBeNull();
  });

  it("lists only the caller's tenant messages", async () => {
    await repository.create("org_a", baseData);
    await repository.create("org_b", { ...baseData, contextHash: "hash-b" });
    const page = await repository.list("org_a");
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
  });

  it("filters listed messages by tone", async () => {
    await repository.create("org_a", baseData);
    await repository.create("org_a", {
      ...baseData,
      tone: "LUXURY",
      contextHash: "hash-luxury",
    });
    const page = await repository.list("org_a", { tone: "LUXURY" });
    expect(page.total).toBe(1);
    expect(page.items[0]?.tone).toBe("LUXURY");
  });

  it("computes aggregate KPIs per tenant", async () => {
    await repository.create("org_a", baseData);
    await repository.create("org_a", {
      ...baseData,
      tone: "LUXURY",
      contextHash: "hash-luxury",
      inputTokens: 20,
      outputTokens: 10,
    });
    await repository.create("org_b", { ...baseData, contextHash: "hash-other-tenant" });

    const kpis = await repository.kpis("org_a");
    expect(kpis.totalMessages).toBe(2);
    expect(kpis.totalInputTokens).toBe(120);
    expect(kpis.totalOutputTokens).toBe(60);
    expect(kpis.byTone).toEqual({ FRIENDLY: 1, LUXURY: 1 });
  });

  it("returns zeroed KPIs for a tenant with no messages", async () => {
    const kpis = await repository.kpis("org_empty");
    expect(kpis).toEqual({
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byTone: {},
    });
  });
});
