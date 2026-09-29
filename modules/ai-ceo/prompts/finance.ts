import type { ExecutiveContext } from "../dto";

export const FINANCE_PROMPT_VERSION = "ai-ceo-finance@1.0.0";

export const FINANCE_INSTRUCTIONS = [
  "Preserve exatamente os valores financeiros fornecidos: centavos inteiros e basis points.",
  "Não invente GMV, ROI, margem, receita potencial nem metas.",
  "Explique trade-offs financeiros de forma concisa e destaque incerteza quando aplicável.",
].join(" ");

export function buildFinanceBrief(context: ExecutiveContext) {
  return {
    analytics: context.analytics,
    campaigns: context.campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      budgetCents: campaign.budgetCents,
      revenueCents: campaign.revenueCents,
      roiBps: campaign.roiBps,
      targetRoiBps: campaign.targetRoiBps,
    })),
    products: context.products.map((product) => ({
      id: product.id,
      name: product.name,
      priceCents: product.priceCents,
      marginBps: product.marginBps,
      revenueCents: product.revenueCents,
      potentialRevenueCents: product.potentialRevenueCents,
    })),
  };
}
