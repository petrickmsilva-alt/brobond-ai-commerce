import "server-only";

import { callOpenAiResponses, DEFAULT_MODEL } from "@/modules/ai/openai/client";
import type { ExecutiveContext, RevenueOpportunity } from "../dto";
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
} from "../prompts/strategist";
import { executiveReportResponseSchema, executiveStrategyResponseSchema } from "../validators";

export class ExecutiveAIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutiveAIResponseError";
  }
}

function parseJson(outputText: string): unknown {
  try {
    return JSON.parse(outputText);
  } catch {
    throw new ExecutiveAIResponseError("AI CEO returned invalid JSON.");
  }
}

export interface ExecutiveAIResult<T> {
  data: T;
  rawResponse: unknown;
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
}

/** OpenAI-backed advisory analysis through the existing PR007 Responses client. */
export async function requestExecutiveStrategy(
  context: ExecutiveContext,
  opportunities: readonly RevenueOpportunity[],
): Promise<ExecutiveAIResult<ReturnType<typeof executiveStrategyResponseSchema.parse>>> {
  const response = await callOpenAiResponses({
    instructions: STRATEGIST_INSTRUCTIONS,
    input: buildStrategistInput(context, opportunities),
    model: DEFAULT_MODEL,
    temperature: AI_CEO_TEMPERATURE,
    jsonSchema: { name: "ai_ceo_executive_strategy", schema: STRATEGIST_OUTPUT_SCHEMA },
  });
  const rawResponse = parseJson(response.outputText);
  const data = executiveStrategyResponseSchema.parse(rawResponse);
  return {
    data,
    rawResponse,
    promptVersion: AI_CEO_STRATEGIST_PROMPT_VERSION,
    model: response.model,
    temperature: AI_CEO_TEMPERATURE,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}

/** Versioned daily report narrative. Numeric metrics are persisted from context. */
export async function requestExecutiveReport(
  context: ExecutiveContext,
  opportunities: readonly RevenueOpportunity[],
): Promise<ExecutiveAIResult<ReturnType<typeof executiveReportResponseSchema.parse>>> {
  const response = await callOpenAiResponses({
    instructions: EXECUTIVE_REPORT_INSTRUCTIONS,
    input: buildExecutiveReportInput(context, opportunities),
    model: DEFAULT_MODEL,
    temperature: AI_CEO_TEMPERATURE,
    jsonSchema: { name: "ai_ceo_daily_report", schema: EXECUTIVE_REPORT_OUTPUT_SCHEMA },
  });
  const rawResponse = parseJson(response.outputText);
  const data = executiveReportResponseSchema.parse(rawResponse);
  return {
    data,
    rawResponse,
    promptVersion: AI_CEO_REPORT_PROMPT_VERSION,
    model: response.model,
    temperature: AI_CEO_TEMPERATURE,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
