import type { ExecutiveContext, RevenueOpportunity } from "../dto";

export const OPERATIONS_PROMPT_VERSION = "ai-ceo-operations@1.0.0";

export const OPERATIONS_INSTRUCTIONS = [
  "Avalie capacidade operacional, cobertura de creators, outreach, campanhas e delivery.",
  "Nunca afirme que uma ação foi executada e nunca solicite execução automática.",
  "Trate falhas e backlog como riscos que exigem validação humana.",
].join(" ");

/** JSON-safe operational slice used in the versioned strategist prompt. */
export function buildOperationsBrief(
  context: ExecutiveContext,
  opportunities: readonly RevenueOpportunity[],
) {
  return {
    generatedAt: context.generatedAt,
    campaigns: context.campaigns,
    creators: context.creators,
    products: context.products,
    trends: context.trends,
    outreach: context.outreach,
    delivery: context.delivery,
    detectedOpportunities: opportunities.map((opportunity) => ({
      key: opportunity.key,
      type: opportunity.type,
      category: opportunity.category,
      title: opportunity.title,
      reason: opportunity.reason,
      confidence: opportunity.confidence,
      criteria: opportunity.criteria,
    })),
  };
}
