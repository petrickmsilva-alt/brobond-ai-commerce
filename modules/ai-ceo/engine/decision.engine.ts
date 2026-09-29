import type {
  AIDecisionDraft,
  AIExecutiveRecommendation,
  DecisionEvidenceInput,
  DecisionStatusName,
  ExecutiveContext,
  RevenueOpportunity,
} from "../dto";
import { calculatePriority, DECISION_PRIORITY_RANK } from "./priority.engine";
import { findRevenueOpportunities } from "./opportunity.engine";

export const MAX_EXECUTIVE_DECISIONS = 20;

const TRANSITIONS: Readonly<Record<DecisionStatusName, readonly DecisionStatusName[]>> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["EXECUTED"],
  REJECTED: [],
  EXECUTED: [],
};

/** Human-governed state machine. No transition performs an operational action. */
export function canTransitionDecision(from: DecisionStatusName, to: DecisionStatusName): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidDecisionTransitionError extends Error {
  constructor(from: DecisionStatusName, to: DecisionStatusName) {
    super(`Invalid AI decision transition: ${from} → ${to}.`);
    this.name = "InvalidDecisionTransitionError";
  }
}

export function assertDecisionTransition(from: DecisionStatusName, to: DecisionStatusName): void {
  if (!canTransitionDecision(from, to)) {
    throw new InvalidDecisionTransitionError(from, to);
  }
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function normalizeEvidence(evidence: readonly DecisionEvidenceInput[]): DecisionEvidenceInput[] {
  const safe = evidence
    .filter((item) => item.sourceType.trim() !== "" && item.sourceId.trim() !== "")
    .map((item) => ({
      ...item,
      weight: Math.max(0, Number.isFinite(item.weight) ? item.weight : 0),
    }));
  const total = safe.reduce((sum, item) => sum + item.weight, 0);
  if (safe.length === 0) return [];
  if (total === 0) {
    const weight = Math.round((1 / safe.length) * 100) / 100;
    return safe.map((item) => ({ ...item, weight }));
  }
  return safe.map((item) => ({
    ...item,
    weight: Math.round((item.weight / total) * 100) / 100,
  }));
}

/**
 * Produce auditable PENDING decisions from deterministic opportunities and
 * optional OpenAI wording. A recommendation must reference a known
 * `opportunityKey`; unknown/model-invented keys are discarded. Priority,
 * revenue, category and evidence always come from the rules engines.
 */
export function generateExecutiveDecisions(
  context: ExecutiveContext,
  recommendations: readonly AIExecutiveRecommendation[] = [],
  suppliedOpportunities?: readonly RevenueOpportunity[],
): AIDecisionDraft[] {
  const opportunities = suppliedOpportunities ?? findRevenueOpportunities(context);
  const opportunityByKey = new Map(opportunities.map((item) => [item.key, item]));
  const recommendationByKey = new Map<string, AIExecutiveRecommendation>();

  for (const recommendation of recommendations) {
    if (
      opportunityByKey.has(recommendation.opportunityKey) &&
      !recommendationByKey.has(recommendation.opportunityKey)
    ) {
      recommendationByKey.set(recommendation.opportunityKey, recommendation);
    }
  }

  return opportunities
    .map((opportunity): AIDecisionDraft => {
      const recommendation = recommendationByKey.get(opportunity.key);
      return {
        sourceKey: opportunity.key,
        title: recommendation?.title.trim() || opportunity.title,
        description: recommendation?.description.trim() || opportunity.description,
        reason: recommendation?.reason.trim() || opportunity.reason,
        priority: calculatePriority(opportunity.criteria),
        status: "PENDING",
        confidence: clampConfidence(
          recommendation
            ? opportunity.confidence * 0.7 + recommendation.confidence * 0.3
            : opportunity.confidence,
        ),
        category: opportunity.category,
        potentialRevenueCents: Math.max(0, Math.round(opportunity.criteria.potentialRevenueCents)),
        evidence: normalizeEvidence(opportunity.evidence),
      };
    })
    .filter((decision) => decision.evidence.length > 0)
    .sort(
      (left, right) =>
        DECISION_PRIORITY_RANK[right.priority] - DECISION_PRIORITY_RANK[left.priority] ||
        right.potentialRevenueCents - left.potentialRevenueCents ||
        left.sourceKey.localeCompare(right.sourceKey),
    )
    .slice(0, MAX_EXECUTIVE_DECISIONS);
}
