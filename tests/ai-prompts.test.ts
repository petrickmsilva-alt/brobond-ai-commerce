import { describe, expect, it } from "vitest";
import {
  AI_MESSAGE_OUTPUT_SCHEMA,
  AI_MESSAGE_TONES,
  buildPromptInput,
  getPromptDefinition,
  listPromptDefinitions,
} from "@/modules/ai/openai/prompts";
import { buildPersonalizationContext } from "@/modules/ai/personalization/context-builder";

const baseInput = {
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

describe("AI_MESSAGE_TONES", () => {
  it("ships exactly the five required tones", () => {
    expect(AI_MESSAGE_TONES).toEqual(["FRIENDLY", "PREMIUM", "LUXURY", "STREET", "FITNESS"]);
  });
});

describe("getPromptDefinition()", () => {
  it.each(AI_MESSAGE_TONES)("returns a versioned definition for %s", (tone) => {
    const definition = getPromptDefinition(tone);
    expect(definition.tone).toBe(tone);
    expect(definition.version).toMatch(/^[a-z]+@\d+\.\d+\.\d+$/);
    expect(definition.instructions.length).toBeGreaterThan(20);
  });

  it("throws for an unknown tone", () => {
    expect(() => getPromptDefinition("UNKNOWN" as never)).toThrow(RangeError);
  });

  it("every tone has a unique semantic version", () => {
    const versions = AI_MESSAGE_TONES.map((tone) => getPromptDefinition(tone).version);
    expect(new Set(versions).size).toBe(AI_MESSAGE_TONES.length);
  });

  it("explicitly forbids sending the message — generation only", () => {
    for (const tone of AI_MESSAGE_TONES) {
      const { instructions } = getPromptDefinition(tone);
      expect(instructions.toLowerCase()).toMatch(/nunca envie a mensagem/);
    }
  });
});

describe("listPromptDefinitions()", () => {
  it("returns all 5 definitions in enum order", () => {
    const definitions = listPromptDefinitions();
    expect(definitions).toHaveLength(5);
    expect(definitions.map((d) => d.tone)).toEqual(AI_MESSAGE_TONES);
  });
});

describe("AI_MESSAGE_OUTPUT_SCHEMA", () => {
  it("requires exactly title, message, hashtags, cta", () => {
    expect(AI_MESSAGE_OUTPUT_SCHEMA.required).toEqual(["title", "message", "hashtags", "cta"]);
  });

  it("disallows additional properties", () => {
    expect(AI_MESSAGE_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it("declares hashtags as an array of strings", () => {
    expect(AI_MESSAGE_OUTPUT_SCHEMA.properties.hashtags).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
});

describe("buildPromptInput()", () => {
  it("includes creator, product, campaign and trend details", () => {
    const context = buildPersonalizationContext(baseInput);
    const input = buildPromptInput(context);
    expect(input).toContain("Ana Souza");
    expect(input).toContain("Jaqueta Bomber");
    expect(input).toContain("Lançamento Inverno");
    expect(input).toContain("streetwear");
  });

  it("omits the trend section when no trend is provided", () => {
    const context = buildPersonalizationContext({ ...baseInput, trend: null });
    const input = buildPromptInput(context);
    expect(input).not.toContain("Tendência relevante");
  });

  it("always asks for the required JSON fields", () => {
    const context = buildPersonalizationContext(baseInput);
    const input = buildPromptInput(context);
    expect(input).toMatch(/title, message, hashtags, cta/);
  });

  it("includes the product description when present", () => {
    const context = buildPersonalizationContext(baseInput);
    const input = buildPromptInput(context);
    expect(input).toContain("Jaqueta bomber premium em nylon.");
  });

  it("omits the product description line when absent", () => {
    const context = buildPersonalizationContext({
      ...baseInput,
      product: { ...baseInput.product, description: null },
    });
    const input = buildPromptInput(context);
    expect(input).not.toContain("Descrição do produto");
  });

  it("includes the campaign goal and trend category when present", () => {
    const context = buildPersonalizationContext(baseInput);
    const input = buildPromptInput(context);
    expect(input).toContain("Aumentar vendas em 20%");
    expect(input).toContain("Categoria da tendência");
  });
});

describe("Prompt tones map 1:1 to the AiMessageTone Prisma enum", () => {
  it.each(AI_MESSAGE_TONES)(
    "has a non-empty, JSON-only-response instructions string for %s",
    (tone) => {
      const { instructions } = getPromptDefinition(tone);
      expect(instructions.trim().length).toBeGreaterThan(0);
      expect(instructions.toLowerCase()).toContain("json");
    },
  );

  it("has exactly one prompt definition per tone — no duplicates, no gaps", () => {
    const definitions = listPromptDefinitions();
    expect(new Set(definitions.map((d) => d.tone)).size).toBe(AI_MESSAGE_TONES.length);
  });

  it("every prompt version encodes the tone name in lowercase", () => {
    for (const tone of AI_MESSAGE_TONES) {
      expect(getPromptDefinition(tone).version.startsWith(tone.toLowerCase())).toBe(true);
    }
  });

  it("keeps prompt instructions distinct across all five tones", () => {
    const instructions = AI_MESSAGE_TONES.map((tone) => getPromptDefinition(tone).instructions);
    expect(new Set(instructions).size).toBe(5);
  });

  it("keeps every instruction under a reasonable length for a single Responses API call", () => {
    for (const tone of AI_MESSAGE_TONES) {
      expect(getPromptDefinition(tone).instructions.length).toBeLessThan(2000);
    }
  });
});
