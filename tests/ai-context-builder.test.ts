import { describe, expect, it } from "vitest";
import {
  buildPersonalizationContext,
  readContextSnapshot,
  serializeContext,
  serializeContextForHash,
} from "@/modules/ai/personalization/context-builder";

const fullInput = {
  creator: {
    id: "creator_1",
    displayName: "Ana Souza",
    handle: "ana.souza",
    niche: "Moda",
    engagementRate: 8.4,
    avgViews: 12000,
  },
  product: {
    id: "product_1",
    name: "Jaqueta Bomber",
    description: "Jaqueta bomber premium em nylon.",
    priceCents: 29900,
    currency: "BRL",
  },
  campaign: {
    id: "campaign_1",
    name: "Lançamento Inverno",
    goal: "Aumentar vendas em 20%",
  },
  trend: {
    keyword: "streetwear",
    category: "Moda",
    score: 87,
  },
};

describe("buildPersonalizationContext()", () => {
  it("maps every field from the domain records", () => {
    const context = buildPersonalizationContext(fullInput);
    expect(context).toEqual({
      creator: {
        id: "creator_1",
        name: "Ana Souza",
        handle: "ana.souza",
        niche: "Moda",
        engagementRate: 8.4,
        avgViews: 12000,
      },
      product: {
        id: "product_1",
        name: "Jaqueta Bomber",
        description: "Jaqueta bomber premium em nylon.",
        priceCents: 29900,
        currency: "BRL",
      },
      campaign: {
        id: "campaign_1",
        name: "Lançamento Inverno",
        goal: "Aumentar vendas em 20%",
      },
      trend: {
        keyword: "streetwear",
        category: "Moda",
        score: 87,
      },
    });
  });

  it("defaults optional creator/product/campaign fields", () => {
    const context = buildPersonalizationContext({
      creator: { id: "c1", displayName: "Bea", handle: "bea", niche: "Fitness" },
      product: { id: "p1", name: "Whey" },
      campaign: { id: "cp1", name: "Verão" },
    });
    expect(context.creator.engagementRate).toBe(0);
    expect(context.creator.avgViews).toBe(0);
    expect(context.product.description).toBe("");
    expect(context.product.priceCents).toBe(0);
    expect(context.product.currency).toBe("BRL");
    expect(context.campaign.goal).toBe("");
    expect(context.trend).toBeNull();
  });

  it("treats an omitted trend and a null trend identically", () => {
    const withNull = buildPersonalizationContext({ ...fullInput, trend: null });
    const withoutKey = buildPersonalizationContext({
      creator: fullInput.creator,
      product: fullInput.product,
      campaign: fullInput.campaign,
    });
    expect(withNull.trend).toBeNull();
    expect(withoutKey.trend).toBeNull();
  });
});

describe("serializeContextForHash()", () => {
  it("is deterministic for the same context and prompt version", () => {
    const context = buildPersonalizationContext(fullInput);
    const a = serializeContextForHash(context, "friendly@1.0.0");
    const b = serializeContextForHash(context, "friendly@1.0.0");
    expect(a).toBe(b);
  });

  it("changes when the prompt version changes", () => {
    const context = buildPersonalizationContext(fullInput);
    const a = serializeContextForHash(context, "friendly@1.0.0");
    const b = serializeContextForHash(context, "friendly@1.0.1");
    expect(a).not.toBe(b);
  });

  it("changes when any context field changes", () => {
    const context = buildPersonalizationContext(fullInput);
    const mutated = buildPersonalizationContext({
      ...fullInput,
      product: { ...fullInput.product, name: "Jaqueta Bomber v2" },
    });
    expect(serializeContextForHash(context, "friendly@1.0.0")).not.toBe(
      serializeContextForHash(mutated, "friendly@1.0.0"),
    );
  });

  it("is stable across different (but semantically equal) trend nullability", () => {
    const context = buildPersonalizationContext({ ...fullInput, trend: null });
    const serialized = serializeContextForHash(context, "friendly@1.0.0");
    expect(JSON.parse(serialized).trend).toBeNull();
  });

  it("is insensitive to input property ordering (stable key order in output)", () => {
    const context1 = buildPersonalizationContext(fullInput);
    const reordered = {
      trend: fullInput.trend,
      campaign: fullInput.campaign,
      product: fullInput.product,
      creator: fullInput.creator,
    };
    const context2 = buildPersonalizationContext(reordered);
    expect(serializeContextForHash(context1, "friendly@1.0.0")).toBe(
      serializeContextForHash(context2, "friendly@1.0.0"),
    );
  });

  it("changes when the creator engagement rate changes", () => {
    const context = buildPersonalizationContext(fullInput);
    const mutated = buildPersonalizationContext({
      ...fullInput,
      creator: { ...fullInput.creator, engagementRate: 99 },
    });
    expect(serializeContextForHash(context, "friendly@1.0.0")).not.toBe(
      serializeContextForHash(mutated, "friendly@1.0.0"),
    );
  });

  it("changes when the trend keyword changes", () => {
    const context = buildPersonalizationContext(fullInput);
    const mutated = buildPersonalizationContext({
      ...fullInput,
      trend: { ...fullInput.trend, keyword: "different-trend" },
    });
    expect(serializeContextForHash(context, "friendly@1.0.0")).not.toBe(
      serializeContextForHash(mutated, "friendly@1.0.0"),
    );
  });
});

// ------------------------------------------------------------------
// PR007.1 — AI Context Audit
// ------------------------------------------------------------------

const auditedInput = {
  creator: {
    id: "creator_1",
    displayName: "Ana Souza",
    handle: "ana.souza",
    niche: "Moda",
    engagementRate: 8.4,
    avgViews: 12000,
    score: 82,
  },
  product: {
    id: "product_1",
    name: "Jaqueta Bomber",
    priceCents: 29900,
    margin: 3550,
  },
  campaign: { id: "campaign_1", name: "Lançamento Inverno" },
  trend: { keyword: "streetwear", score: 87 },
};

describe("serializeContext() — PR007.1", () => {
  it("includes every mandatory audit field", () => {
    const snapshot = serializeContext(auditedInput);
    expect(snapshot).toEqual({
      creator: {
        id: "creator_1",
        name: "Ana Souza",
        handle: "ana.souza",
        niche: "Moda",
        score: 82,
      },
      product: { id: "product_1", name: "Jaqueta Bomber", margin: 3550 },
      campaign: { id: "campaign_1", name: "Lançamento Inverno" },
      trend: { keyword: "streetwear", score: 87 },
    });
  });

  it("maps creator.name from displayName", () => {
    expect(serializeContext(auditedInput).creator.name).toBe("Ana Souza");
  });

  it("serializes trend as null when the generation was not trend-driven", () => {
    const snapshot = serializeContext({
      creator: auditedInput.creator,
      product: auditedInput.product,
      campaign: auditedInput.campaign,
    });
    expect(snapshot.trend).toBeNull();
  });

  it("treats an omitted trend and a null trend identically", () => {
    const withNull = serializeContext({ ...auditedInput, trend: null });
    const without = serializeContext({
      creator: auditedInput.creator,
      product: auditedInput.product,
      campaign: auditedInput.campaign,
    });
    expect(withNull.trend).toBeNull();
    expect(without.trend).toBeNull();
    expect(JSON.stringify(withNull)).toBe(JSON.stringify(without));
  });

  it("serializes an uncaptured creator score as null (never omitted)", () => {
    const snapshot = serializeContext({
      ...auditedInput,
      creator: {
        id: "c1",
        displayName: "Bea",
        handle: "bea",
        niche: "Fitness",
      },
    });
    expect(snapshot.creator.score).toBeNull();
    expect(Object.keys(snapshot.creator)).toContain("score");
  });

  it("serializes an uncaptured product margin as null (never omitted)", () => {
    const snapshot = serializeContext({
      ...auditedInput,
      product: { id: "p1", name: "Whey" },
    });
    expect(snapshot.product.margin).toBeNull();
    expect(Object.keys(snapshot.product)).toContain("margin");
  });

  it("serializes an uncaptured trend score as null", () => {
    const snapshot = serializeContext({
      ...auditedInput,
      trend: { keyword: "y2k" },
    });
    expect(snapshot.trend).toEqual({ keyword: "y2k", score: null });
  });

  it("keeps a score of 0 instead of nullish-coalescing it away", () => {
    const snapshot = serializeContext({
      ...auditedInput,
      creator: { ...auditedInput.creator, score: 0 },
      product: { ...auditedInput.product, margin: 0 },
    });
    expect(snapshot.creator.score).toBe(0);
    expect(snapshot.product.margin).toBe(0);
  });

  it("is deterministic and JSON-round-trip safe", () => {
    const a = serializeContext(auditedInput);
    const b = serializeContext(auditedInput);
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("has a frozen key order (creator → product → campaign → trend)", () => {
    const snapshot = serializeContext(auditedInput);
    expect(Object.keys(snapshot)).toEqual(["creator", "product", "campaign", "trend"]);
    expect(Object.keys(snapshot.creator)).toEqual(["id", "name", "handle", "niche", "score"]);
    expect(Object.keys(snapshot.product)).toEqual(["id", "name", "margin"]);
    expect(Object.keys(snapshot.campaign)).toEqual(["id", "name"]);
    expect(Object.keys(snapshot.trend ?? {})).toEqual(["keyword", "score"]);
  });

  it("produces the same snapshot regardless of input property ordering", () => {
    const reordered = {
      trend: auditedInput.trend,
      campaign: auditedInput.campaign,
      product: auditedInput.product,
      creator: auditedInput.creator,
    };
    expect(JSON.stringify(serializeContext(reordered))).toBe(
      JSON.stringify(serializeContext(auditedInput)),
    );
  });

  it("never feeds the cache hash — hash inputs stay identical with audit fields present", () => {
    // Retrocompat: adding score/margin to the input must NOT change the
    // PR007 context (they are audit-only fields and never reach the hash).
    const plain = buildPersonalizationContext({
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
      trend: { keyword: "streetwear", score: 87 },
    });
    const withAuditFields = buildPersonalizationContext(auditedInput);
    expect(withAuditFields).toEqual(plain);
    expect(serializeContextForHash(plain, "friendly@1.0.0")).toBe(
      serializeContextForHash(withAuditFields, "friendly@1.0.0"),
    );
  });
});

describe("readContextSnapshot() — PR007.1", () => {
  it("round-trips a serializeContext() output", () => {
    const snapshot = serializeContext(auditedInput);
    const parsed = readContextSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(parsed).toEqual(snapshot);
  });

  it("accepts a null trend", () => {
    const snapshot = serializeContext({ ...auditedInput, trend: null });
    expect(readContextSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("returns null for a legacy NULL column", () => {
    expect(readContextSnapshot(null)).toBeNull();
  });

  it("returns null for non-object payloads", () => {
    expect(readContextSnapshot("nope")).toBeNull();
    expect(readContextSnapshot(42)).toBeNull();
    expect(readContextSnapshot(undefined)).toBeNull();
  });

  it("returns null when a required block is malformed", () => {
    const snapshot = serializeContext(auditedInput) as unknown as Record<string, unknown>;
    expect(readContextSnapshot({ ...snapshot, creator: null })).toBeNull();
    expect(readContextSnapshot({ ...snapshot, product: { id: "p1" } })).toBeNull();
    expect(readContextSnapshot({ ...snapshot, campaign: { id: 1, name: "x" } })).toBeNull();
    expect(readContextSnapshot({ ...snapshot, trend: { keyword: "x" } })).toBeNull();
  });
});
