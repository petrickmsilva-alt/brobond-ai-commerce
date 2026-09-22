import { beforeEach, describe, expect, it, vi } from "vitest";

const callOpenAiResponsesMock = vi.hoisted(() => vi.fn());

vi.mock("@/modules/ai/openai/client", () => ({
  callOpenAiResponses: callOpenAiResponsesMock,
  DEFAULT_MODEL: "gpt-4o-mini",
}));

const { generatePersonalizedMessage, parseGeneratedContent, GeneratedContentValidationError } =
  await import("@/modules/ai/openai/generator");
const { buildPersonalizationContext } =
  await import("@/modules/ai/personalization/context-builder");

const context = buildPersonalizationContext({
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
});

beforeEach(() => {
  callOpenAiResponsesMock.mockReset();
});

describe("parseGeneratedContent()", () => {
  it("parses a valid JSON payload into the required shape", () => {
    const content = parseGeneratedContent(
      '{"title":"T","message":"M","hashtags":["#a","#b"],"cta":"Compre já"}',
    );
    expect(content).toEqual({ title: "T", message: "M", hashtags: ["#a", "#b"], cta: "Compre já" });
  });

  it("rejects invalid JSON", () => {
    expect(() => parseGeneratedContent("not json")).toThrow(GeneratedContentValidationError);
  });

  it.each([
    ['{"message":"M","hashtags":[],"cta":"c"}', "missing title"],
    ['{"title":"","message":"M","hashtags":[],"cta":"c"}', "empty title"],
    ['{"title":"T","hashtags":[],"cta":"c"}', "missing message"],
    ['{"title":"T","message":"M","cta":"c"}', "missing hashtags"],
    ['{"title":"T","message":"M","hashtags":"not-array","cta":"c"}', "hashtags not an array"],
    ['{"title":"T","message":"M","hashtags":[1,2],"cta":"c"}', "hashtags not strings"],
    ['{"title":"T","message":"M","hashtags":[]}', "missing cta"],
  ])("rejects %s (%s)", (raw) => {
    expect(() => parseGeneratedContent(raw)).toThrow(GeneratedContentValidationError);
  });

  it("rejects a non-object JSON payload", () => {
    expect(() => parseGeneratedContent("42")).toThrow(GeneratedContentValidationError);
    expect(() => parseGeneratedContent("null")).toThrow(GeneratedContentValidationError);
  });
});

describe("generatePersonalizedMessage()", () => {
  it("never calls a real network endpoint — the client is fully mocked", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: '{"title":"T","message":"M","hashtags":["#moda"],"cta":"Saiba mais"}',
      model: "gpt-4o-mini",
      inputTokens: 100,
      outputTokens: 50,
    });

    const result = await generatePersonalizedMessage({ tone: "FRIENDLY", context });

    expect(callOpenAiResponsesMock).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual({
      title: "T",
      message: "M",
      hashtags: ["#moda"],
      cta: "Saiba mais",
    });
    expect(result.promptVersion).toBe("friendly@1.0.0");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it("passes the tone's instructions and a structured JSON schema request", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: '{"title":"T","message":"M","hashtags":[],"cta":"c"}',
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
    });

    await generatePersonalizedMessage({ tone: "LUXURY", context, temperature: 0.9 });

    const call = callOpenAiResponsesMock.mock.calls.at(-1)![0];
    expect(call.instructions).toMatch(/luxo|elegante|refinado/i);
    expect(call.temperature).toBe(0.9);
    expect(call.jsonSchema.name).toBe("ai_generated_message");
    expect(call.jsonSchema.schema.required).toEqual(["title", "message", "hashtags", "cta"]);
  });

  it.each(["FRIENDLY", "PREMIUM", "LUXURY", "STREET", "FITNESS"] as const)(
    "resolves the correct prompt version for tone %s",
    async (tone) => {
      callOpenAiResponsesMock.mockResolvedValue({
        outputText: '{"title":"T","message":"M","hashtags":[],"cta":"c"}',
        model: "gpt-4o-mini",
        inputTokens: 1,
        outputTokens: 1,
      });
      const result = await generatePersonalizedMessage({ tone, context });
      expect(result.promptVersion).toBe(`${tone.toLowerCase()}@1.0.0`);
    },
  );

  it("propagates a validation error when OpenAI returns malformed JSON", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: "not json at all",
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(generatePersonalizedMessage({ tone: "STREET", context })).rejects.toBeInstanceOf(
      GeneratedContentValidationError,
    );
  });
});
