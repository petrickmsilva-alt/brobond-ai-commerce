import { describe, expect, it } from "vitest";
import * as aiModule from "@/modules/ai";

/**
 * The public module surface (`modules/ai/index.ts`) must expose the
 * client-safe prompt catalog, the pure context-builder, and the zod
 * validators — but must NEVER re-export anything from `openai/client.ts`
 * or `openai/generator.ts` (the OpenAI-touching, server-only pieces).
 */
describe("modules/ai public surface", () => {
  it("exposes the five-tone prompt catalog", () => {
    expect(aiModule.AI_MESSAGE_TONES).toEqual([
      "FRIENDLY",
      "PREMIUM",
      "LUXURY",
      "STREET",
      "FITNESS",
    ]);
  });

  it("exposes the context builder", () => {
    expect(typeof aiModule.buildPersonalizationContext).toBe("function");
    expect(typeof aiModule.serializeContextForHash).toBe("function");
  });

  it("exposes the generate-message validator", () => {
    expect(aiModule.generateAiMessageSchema).toBeDefined();
    expect(aiModule.aiMessageListSchema).toBeDefined();
  });

  it("does not export the OpenAI client or generator (server-only boundary)", () => {
    expect((aiModule as Record<string, unknown>).callOpenAiResponses).toBeUndefined();
    expect((aiModule as Record<string, unknown>).generatePersonalizedMessage).toBeUndefined();
    expect((aiModule as Record<string, unknown>).OpenAiConfigurationError).toBeUndefined();
  });

  it("exposes prompt lookups usable from a Client Component (no secrets)", () => {
    const definition = aiModule.getPromptDefinition("PREMIUM");
    expect(definition.tone).toBe("PREMIUM");
    expect(definition.instructions).not.toMatch(/sk-[a-zA-Z0-9]/);
  });
});
