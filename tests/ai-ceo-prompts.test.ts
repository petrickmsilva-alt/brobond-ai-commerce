import { describe, expect, it } from "vitest";
import { findRevenueOpportunities } from "@/modules/ai-ceo/engine/opportunity.engine";
import {
  AI_CEO_REPORT_PROMPT_VERSION,
  AI_CEO_STRATEGIST_PROMPT_VERSION,
  AI_CEO_TEMPERATURE,
  buildExecutiveReportInput,
  buildStrategistInput,
  EXECUTIVE_REPORT_INSTRUCTIONS,
  EXECUTIVE_REPORT_OUTPUT_SCHEMA,
  STRATEGIST_INSTRUCTIONS,
  STRATEGIST_OUTPUT_SCHEMA,
} from "@/modules/ai-ceo/prompts/strategist";
import { FINANCE_PROMPT_VERSION } from "@/modules/ai-ceo/prompts/finance";
import { OPERATIONS_PROMPT_VERSION } from "@/modules/ai-ceo/prompts/operations";
import { executiveContextFixture } from "./ai-ceo-fixture";

describe("AI CEO versioned prompts — PR011", () => {
  it("pins the OpenAI temperature to 0.3", () => {
    expect(AI_CEO_TEMPERATURE).toBe(0.3);
  });

  it.each([
    AI_CEO_STRATEGIST_PROMPT_VERSION,
    AI_CEO_REPORT_PROMPT_VERSION,
    FINANCE_PROMPT_VERSION,
    OPERATIONS_PROMPT_VERSION,
  ])("uses an explicit semantic prompt version: %s", (version) => {
    expect(version).toMatch(/@\d+\.\d+\.\d+$/);
  });

  it("explicitly forbids direct execution in strategist instructions", () => {
    expect(STRATEGIST_INSTRUCTIONS).toContain("NÃO executa");
    expect(STRATEGIST_INSTRUCTIONS).toContain("PENDING");
  });

  it("explicitly forbids direct execution in report instructions", () => {
    expect(EXECUTIVE_REPORT_INSTRUCTIONS).toContain("NÃO executa");
  });

  it("serializes only detected opportunity keys for model grounding", () => {
    const context = executiveContextFixture();
    const opportunities = findRevenueOpportunities(context);
    const input = JSON.parse(buildStrategistInput(context, opportunities));
    expect(input.operations.detectedOpportunities.map((item: { key: string }) => item.key)).toEqual(
      opportunities.map((item) => item.key),
    );
  });

  it("preserves authoritative financial values in the strategist input", () => {
    const context = executiveContextFixture();
    const input = JSON.parse(buildStrategistInput(context, findRevenueOpportunities(context)));
    expect(input.finance.analytics.gmvCents).toBe(context.analytics.gmvCents);
    expect(input.finance.analytics.roiBps).toBe(context.analytics.roiBps);
  });

  it.each(["Resumo", "GMV", "ROI", "Creators", "Produtos", "Campanhas", "Riscos", "Oportunidades"])(
    "requests executive report section %s",
    (section) => {
      const context = executiveContextFixture();
      const input = JSON.parse(buildExecutiveReportInput(context, []));
      expect(input.requiredSections).toContain(section);
    },
  );

  it("uses strict JSON schemas with no additional properties", () => {
    expect(STRATEGIST_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(EXECUTIVE_REPORT_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it("requires opportunityKey in every model-produced decision", () => {
    const item = STRATEGIST_OUTPUT_SCHEMA.properties.decisions.items;
    expect(item.required).toContain("opportunityKey");
  });
});
