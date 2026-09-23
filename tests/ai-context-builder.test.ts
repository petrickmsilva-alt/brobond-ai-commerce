import { describe, expect, it } from "vitest";
import {
  buildPersonalizationContext,
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
