import type { ExecutiveContext, RevenueOpportunity } from "../dto";
import { buildFinanceBrief, FINANCE_INSTRUCTIONS, FINANCE_PROMPT_VERSION } from "./finance";
import {
  buildOperationsBrief,
  OPERATIONS_INSTRUCTIONS,
  OPERATIONS_PROMPT_VERSION,
} from "./operations";

export const AI_CEO_TEMPERATURE = 0.3;
export const AI_CEO_STRATEGIST_PROMPT_VERSION = "ai-ceo-strategist@1.0.0";
export const AI_CEO_REPORT_PROMPT_VERSION = "ai-ceo-daily-report@1.0.0";

const GOVERNANCE = [
  "Você é o AI CEO consultivo do BROBOND AI COMMERCE OS.",
  "Sua função é analisar e recomendar; você NÃO executa nenhuma ação.",
  "Toda decisão nasce PENDING e só humanos podem aprovar, rejeitar ou confirmar execução.",
  "Use apenas opportunityKey fornecida; não invente evidências, entidades ou números.",
  "Escreva em português do Brasil, de forma executiva, concreta e auditável.",
].join(" ");

export const STRATEGIST_INSTRUCTIONS = [
  GOVERNANCE,
  OPERATIONS_INSTRUCTIONS,
  FINANCE_INSTRUCTIONS,
  "Retorne estritamente o JSON do schema solicitado.",
].join(" ");

export const EXECUTIVE_REPORT_INSTRUCTIONS = [
  GOVERNANCE,
  OPERATIONS_INSTRUCTIONS,
  FINANCE_INSTRUCTIONS,
  "Produza um resumo diário e listas objetivas de riscos e oportunidades.",
  "Retorne estritamente o JSON do schema solicitado.",
].join(" ");

export const STRATEGIST_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    decisions: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          opportunityKey: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["opportunityKey", "title", "description", "reason", "confidence"],
      },
    },
  },
  required: ["summary", "decisions"],
} as const;

export const EXECUTIVE_REPORT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    risks: { type: "array", maxItems: 10, items: { type: "string" } },
    opportunities: { type: "array", maxItems: 10, items: { type: "string" } },
  },
  required: ["summary", "risks", "opportunities"],
} as const;

export function buildStrategistInput(
  context: ExecutiveContext,
  opportunities: readonly RevenueOpportunity[],
): string {
  return JSON.stringify({
    promptChain: {
      strategist: AI_CEO_STRATEGIST_PROMPT_VERSION,
      operations: OPERATIONS_PROMPT_VERSION,
      finance: FINANCE_PROMPT_VERSION,
    },
    operations: buildOperationsBrief(context, opportunities),
    finance: buildFinanceBrief(context),
    request:
      "Reescreva e priorize somente as oportunidades detectadas. Retorne opportunityKey exatamente como recebida.",
  });
}

export function buildExecutiveReportInput(
  context: ExecutiveContext,
  opportunities: readonly RevenueOpportunity[],
): string {
  return JSON.stringify({
    promptChain: {
      report: AI_CEO_REPORT_PROMPT_VERSION,
      operations: OPERATIONS_PROMPT_VERSION,
      finance: FINANCE_PROMPT_VERSION,
    },
    operations: buildOperationsBrief(context, opportunities),
    finance: buildFinanceBrief(context),
    requiredSections: [
      "Resumo",
      "GMV",
      "ROI",
      "Creators",
      "Produtos",
      "Campanhas",
      "Riscos",
      "Oportunidades",
    ],
  });
}
