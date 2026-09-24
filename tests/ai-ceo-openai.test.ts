import { beforeEach, describe, expect, it, vi } from "vitest";
import { executiveContextFixture } from "./ai-ceo-fixture";
import { findRevenueOpportunities } from "@/modules/ai-ceo/engine/opportunity.engine";
import { AI_CEO_TEMPERATURE } from "@/modules/ai-ceo/prompts/strategist";

const callOpenAiResponsesMock = vi.hoisted(() => vi.fn());
vi.mock("@/modules/ai/openai/client", () => ({
  DEFAULT_MODEL: "gpt-4o-mini",
  callOpenAiResponses: callOpenAiResponsesMock,
}));

const { requestExecutiveReport, requestExecutiveStrategy, ExecutiveAIResponseError } =
  await import("@/modules/ai-ceo/engine/executive-ai.engine");

describe("AI CEO OpenAI PR007 integration — PR011", () => {
  beforeEach(() => {
    callOpenAiResponsesMock.mockReset();
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: JSON.stringify({
        summary: "Resumo executivo",
        decisions: [
          {
            opportunityKey: "product:product_1:creator-coverage",
            title: "Expandir cobertura",
            description: "Descrição",
            reason: "Razão",
            confidence: 0.9,
          },
        ],
      }),
      model: "gpt-4o-mini-2026-01-01",
      inputTokens: 123,
      outputTokens: 45,
    });
  });

  it("calls the existing PR007 Responses API client at fixed temperature 0.3", async () => {
    const context = executiveContextFixture();
    await requestExecutiveStrategy(context, findRevenueOpportunities(context));
    expect(callOpenAiResponsesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-4o-mini",
        temperature: AI_CEO_TEMPERATURE,
        jsonSchema: expect.objectContaining({ name: "ai_ceo_executive_strategy" }),
      }),
    );
  });

  it("returns prompt/model/token metadata for persistence", async () => {
    const context = executiveContextFixture();
    const result = await requestExecutiveStrategy(context, findRevenueOpportunities(context));
    expect(result).toMatchObject({
      promptVersion: "ai-ceo-strategist@1.0.0",
      model: "gpt-4o-mini-2026-01-01",
      temperature: 0.3,
      inputTokens: 123,
      outputTokens: 45,
    });
    expect(result.rawResponse).toEqual(result.data);
  });

  it("rejects invalid JSON instead of creating unauditable decisions", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: "not-json",
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(requestExecutiveStrategy(executiveContextFixture(), [])).rejects.toBeInstanceOf(
      ExecutiveAIResponseError,
    );
  });

  it("rejects structured output outside the strict strategy schema", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: JSON.stringify({ summary: "ok", decisions: [{ invented: true }] }),
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
    });
    await expect(requestExecutiveStrategy(executiveContextFixture(), [])).rejects.toBeDefined();
  });

  it("generates all narrative sections for the daily report", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: JSON.stringify({
        summary: "Resumo diário",
        risks: ["Risco de ROI"],
        opportunities: ["Creator premium"],
      }),
      model: "gpt-4o-mini",
      inputTokens: 80,
      outputTokens: 30,
    });
    const result = await requestExecutiveReport(executiveContextFixture(), []);
    expect(result.data).toEqual({
      summary: "Resumo diário",
      risks: ["Risco de ROI"],
      opportunities: ["Creator premium"],
    });
    expect(result.promptVersion).toBe("ai-ceo-daily-report@1.0.0");
  });

  it("uses fixed temperature 0.3 for the daily report too", async () => {
    callOpenAiResponsesMock.mockResolvedValue({
      outputText: JSON.stringify({ summary: "Resumo", risks: [], opportunities: [] }),
      model: "gpt-4o-mini",
      inputTokens: 1,
      outputTokens: 1,
    });
    await requestExecutiveReport(executiveContextFixture(), []);
    expect(callOpenAiResponsesMock.mock.calls[0]?.[0].temperature).toBe(0.3);
  });
});
