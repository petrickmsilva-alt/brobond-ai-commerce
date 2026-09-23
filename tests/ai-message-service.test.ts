import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/lib/rbac";

const generatePersonalizedMessageMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ai/openai/generator", () => ({
  generatePersonalizedMessage: generatePersonalizedMessageMock,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { createAiMessageService, buildContextHash } =
  await import("@/modules/ai/personalization/message.service");

const baseInput = {
  tone: "FRIENDLY" as const,
  creator: {
    id: "creator_1",
    displayName: "Ana Souza",
    handle: "ana.souza",
    niche: "Moda",
    engagementRate: 8.4,
    avgViews: 12000,
  },
  product: { id: "product_1", name: "Jaqueta Bomber", priceCents: 29900 },
  campaign: { id: "campaign_1", name: "Lançamento Inverno" },
};

function fakeDb() {
  const rows: Array<Record<string, any>> = [];
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
  };
  return { db: { aIGeneratedMessage } as never, rows };
}

describe("buildContextHash()", () => {
  it("is deterministic for the same tone + context + prompt version", () => {
    const a = buildContextHash(baseInput, "FRIENDLY", "friendly@1.0.0");
    const b = buildContextHash(baseInput, "FRIENDLY", "friendly@1.0.0");
    expect(a).toBe(b);
  });

  it("changes when the tone changes", () => {
    const a = buildContextHash(baseInput, "FRIENDLY", "friendly@1.0.0");
    const b = buildContextHash(baseInput, "LUXURY", "luxury@1.0.0");
    expect(a).not.toBe(b);
  });

  it("is a 64-char hex sha256 digest", () => {
    const hash = buildContextHash(baseInput, "FRIENDLY", "friendly@1.0.0");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("AI message service — cache contract", () => {
  beforeEach(() => {
    generatePersonalizedMessageMock.mockReset();
    generatePersonalizedMessageMock.mockResolvedValue({
      content: { title: "T", message: "M", hashtags: ["#a"], cta: "c" },
      promptVersion: "friendly@1.0.0",
      model: "gpt-4o-mini",
      temperature: 0.7,
      inputTokens: 100,
      outputTokens: 50,
    });
  });

  it("calls OpenAI and persists a new row on a cache miss", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);
    const { message, cached } = await service.generate("org_a", baseInput);

    expect(generatePersonalizedMessageMock).toHaveBeenCalledTimes(1);
    expect(cached).toBe(false);
    expect(message.organizationId).toBe("org_a");
    expect(message.content).toEqual({ title: "T", message: "M", hashtags: ["#a"], cta: "c" });
  });

  it("never calls OpenAI again for an identical (creator+product+campaign+tone) context", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);

    const first = await service.generate("org_a", baseInput);
    const second = await service.generate("org_a", baseInput);

    expect(generatePersonalizedMessageMock).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.message.id).toBe(first.message.id);
  });

  it("regenerates when the tone changes even for the same creator/product/campaign", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);

    await service.generate("org_a", baseInput);
    await service.generate("org_a", { ...baseInput, tone: "LUXURY" });

    expect(generatePersonalizedMessageMock).toHaveBeenCalledTimes(2);
  });

  it("regenerates when the product changes", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);

    await service.generate("org_a", baseInput);
    await service.generate("org_a", {
      ...baseInput,
      product: { ...baseInput.product, id: "product_2", name: "Outro Produto" },
    });

    expect(generatePersonalizedMessageMock).toHaveBeenCalledTimes(2);
  });

  it("does not share the cache across tenants", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);

    await service.generate("org_a", baseInput);
    await service.generate("org_b", baseInput);

    expect(generatePersonalizedMessageMock).toHaveBeenCalledTimes(2);
  });

  it("rejects generation without an organization id", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);
    await expect(service.generate("", baseInput)).rejects.toBeInstanceOf(AuthorizationError);
    expect(generatePersonalizedMessageMock).not.toHaveBeenCalled();
  });

  it("persists the token usage and prompt version returned by the generator", async () => {
    const { db } = fakeDb();
    const service = createAiMessageService(db);
    const { message } = await service.generate("org_a", baseInput);
    expect(message.inputTokens).toBe(100);
    expect(message.outputTokens).toBe(50);
    expect(message.promptVersion).toBe("friendly@1.0.0");
    expect(message.model).toBe("gpt-4o-mini");
  });
});
