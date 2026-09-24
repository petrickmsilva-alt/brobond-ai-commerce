import type { ExecutiveContext, RevenueOpportunity } from "../dto";
import { calculatePriorityBreakdown, DECISION_PRIORITY_RANK } from "./priority.engine";

export const HIGH_MARGIN_BPS = 5_000;
export const LOW_CREATOR_COVERAGE = 2;
export const PREMIUM_CREATOR_SCORE = 80;
export const GROWING_TREND_SCORE = 70;

function confidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function nonNegativeCents(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

/**
 * Deterministic opportunity detection over the complete executive snapshot.
 * It never calls OpenAI and never mutates operational data. OpenAI may improve
 * wording later, but cannot invent the source keys/evidence returned here.
 */
export function findRevenueOpportunities(context: ExecutiveContext): RevenueOpportunity[] {
  const opportunities: RevenueOpportunity[] = [];
  const analyticsEvidence = {
    sourceType: "AnalyticsSnapshot",
    sourceId: context.analytics.id,
    weight: 0.25,
  };

  for (const product of context.products) {
    if (
      product.status === "ACTIVE" &&
      product.stockQuantity > 0 &&
      product.marginBps >= HIGH_MARGIN_BPS &&
      product.creatorCount <= LOW_CREATOR_COVERAGE
    ) {
      const coverageGap = LOW_CREATOR_COVERAGE + 1 - product.creatorCount;
      opportunities.push({
        key: `product:${product.id}:creator-coverage`,
        type: "HIGH_MARGIN_LOW_CREATORS",
        category: "PRODUCT",
        title: `Expandir creators para ${product.name}`,
        description: `${product.name} combina margem de ${(product.marginBps / 100).toFixed(1)}% com apenas ${product.creatorCount} creator(s) recomendado(s).`,
        reason:
          "Produtos de margem alta e baixa cobertura de creators deixam receita incremental sem distribuição.",
        confidence: confidence(0.72 + coverageGap * 0.06 + product.marginBps / 100_000),
        criteria: {
          roiBps: product.marginBps,
          potentialRevenueCents: nonNegativeCents(product.potentialRevenueCents),
          urgency: product.stockQuantity >= 50 ? 72 : 55,
          trendScore: 50,
        },
        evidence: [
          { sourceType: "Product", sourceId: product.id, weight: 0.75 },
          analyticsEvidence,
        ],
      });
    }
  }

  for (const trend of context.trends) {
    const growing = trend.growthBps > 0 || (trend.previousScore === null && trend.trendScore >= 80);
    if (!trend.hasCampaign && trend.trendScore >= GROWING_TREND_SCORE && growing) {
      opportunities.push({
        key: `trend:${trend.id}:campaign-gap`,
        type: "GROWING_TREND_NO_CAMPAIGN",
        category: "TREND",
        title: `Criar plano para a tendência “${trend.keyword}”`,
        description: `A tendência atingiu score ${trend.trendScore} e crescimento de ${(trend.growthBps / 100).toFixed(1)}%, sem campanha ativa relacionada.`,
        reason: "Momentum crescente sem campanha reduz a janela disponível para capturar demanda.",
        confidence: confidence(
          0.65 + trend.trendScore / 400 + Math.min(0.1, trend.growthBps / 100_000),
        ),
        criteria: {
          roiBps: context.analytics.roiBps,
          potentialRevenueCents: nonNegativeCents(trend.potentialRevenueCents),
          urgency: Math.min(100, 55 + Math.max(0, trend.growthBps) / 200),
          trendScore: trend.trendScore,
        },
        evidence: [
          { sourceType: "TrendSnapshot", sourceId: trend.id, weight: 0.75 },
          analyticsEvidence,
        ],
      });
    }
  }

  for (const creator of context.creators) {
    if (
      creator.score >= PREMIUM_CREATOR_SCORE &&
      creator.outreachCount === 0 &&
      creator.status !== "ARCHIVED"
    ) {
      opportunities.push({
        key: `creator:${creator.id}:first-contact`,
        type: "PREMIUM_CREATOR_NO_CONTACT",
        category: "CREATOR",
        title: `Priorizar contato com ${creator.name}`,
        description: `${creator.name} tem score ${creator.score}, média de ${creator.avgViews.toLocaleString("pt-BR")} visualizações e ainda não possui outreach.`,
        reason:
          "Creators premium sem primeiro contato representam capacidade comercial qualificada ainda não ativada.",
        confidence: confidence(0.68 + creator.score / 500),
        criteria: {
          roiBps: context.analytics.roiBps,
          potentialRevenueCents: nonNegativeCents(creator.potentialRevenueCents),
          urgency: creator.score >= 90 ? 82 : 68,
          trendScore: Math.min(100, creator.score),
        },
        evidence: [
          { sourceType: "CreatorProfile", sourceId: creator.id, weight: 0.75 },
          analyticsEvidence,
        ],
      });
    }
  }

  for (const campaign of context.campaigns) {
    const monitored = ["RUNNING", "COMPLETED", "PAUSED"].includes(campaign.status);
    if (monitored && campaign.roiBps < campaign.targetRoiBps) {
      const gap = campaign.targetRoiBps - campaign.roiBps;
      opportunities.push({
        key: `campaign:${campaign.id}:roi-gap`,
        type: "CAMPAIGN_ROI_BELOW_TARGET",
        category: "CAMPAIGN",
        title: `Revisar ROI da campanha ${campaign.name}`,
        description: `ROI atual de ${(campaign.roiBps / 100).toFixed(1)}% está ${(gap / 100).toFixed(1)} p.p. abaixo da meta.`,
        reason:
          "Campanhas abaixo da meta exigem revisão humana de orçamento, audiência e oferta antes de novos investimentos.",
        confidence: confidence(0.72 + Math.min(0.22, gap / 50_000)),
        criteria: {
          roiBps: campaign.roiBps,
          potentialRevenueCents: nonNegativeCents(
            Math.max(campaign.budgetCents, campaign.revenueCents) * Math.min(2, gap / 10_000),
          ),
          urgency: campaign.status === "RUNNING" ? 90 : 65,
          trendScore: 45,
        },
        evidence: [
          { sourceType: "Campaign", sourceId: campaign.id, weight: 0.7 },
          analyticsEvidence,
        ],
      });
    }
  }

  const deliveryAttempted = context.delivery.sent + context.delivery.failed;
  const failureRateBps =
    deliveryAttempted > 0 ? Math.round((context.delivery.failed / deliveryAttempted) * 10_000) : 0;
  if (context.delivery.failed > 0 && failureRateBps >= 500) {
    opportunities.push({
      key: `delivery:${context.analytics.id}:failure-risk`,
      type: "DELIVERY_FAILURE_RISK",
      category: "OPERATIONS",
      title: "Conter falhas no funil de delivery",
      description: `${context.delivery.failed} entrega(s) falharam; a taxa de falha estimada é ${(failureRateBps / 100).toFixed(1)}%.`,
      reason:
        "Falhas de delivery interrompem o funil de conversão e colocam receita já trabalhada em risco.",
      confidence: confidence(0.75 + Math.min(0.2, failureRateBps / 50_000)),
      criteria: {
        roiBps: context.analytics.roiBps,
        potentialRevenueCents: nonNegativeCents(
          context.analytics.gmvCents * (failureRateBps / 10_000),
        ),
        urgency: Math.min(100, 70 + context.delivery.failed * 2),
        trendScore: 50,
      },
      evidence: [
        { sourceType: "DeliverySummary", sourceId: context.analytics.id, weight: 0.75 },
        analyticsEvidence,
      ],
    });
  }

  const backlog = context.outreach.ready + context.outreach.scheduled;
  if (backlog >= 20) {
    opportunities.push({
      key: `outreach:${context.analytics.id}:backlog`,
      type: "OUTREACH_BACKLOG",
      category: "OPERATIONS",
      title: "Revisar backlog de outreach",
      description: `${backlog} mensagens estão prontas ou agendadas aguardando avanço operacional.`,
      reason:
        "Backlog elevado atrasa contato com creators e reduz a velocidade de ativação de campanhas.",
      confidence: confidence(0.7 + Math.min(0.2, backlog / 500)),
      criteria: {
        roiBps: context.analytics.roiBps,
        potentialRevenueCents: nonNegativeCents(
          (context.analytics.gmvCents / Math.max(1, context.analytics.paidOrders)) * backlog * 0.1,
        ),
        urgency: Math.min(100, 55 + backlog),
        trendScore: 40,
      },
      evidence: [
        { sourceType: "OutreachSummary", sourceId: context.analytics.id, weight: 0.75 },
        analyticsEvidence,
      ],
    });
  }

  return opportunities.sort((left, right) => {
    const leftPriority = calculatePriorityBreakdown(left.criteria);
    const rightPriority = calculatePriorityBreakdown(right.criteria);
    return (
      DECISION_PRIORITY_RANK[rightPriority.priority] -
        DECISION_PRIORITY_RANK[leftPriority.priority] ||
      rightPriority.score - leftPriority.score ||
      right.criteria.potentialRevenueCents - left.criteria.potentialRevenueCents ||
      left.key.localeCompare(right.key)
    );
  });
}
