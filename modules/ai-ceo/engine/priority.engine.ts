import type { DecisionPriorityName, PriorityCriteria } from "../dto";

export interface PriorityBreakdown {
  roi: number;
  revenue: number;
  urgency: number;
  trend: number;
  score: number;
  priority: DecisionPriorityName;
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Turn actual ROI into an intervention score. A loss/very low return demands
 * executive attention; healthy ROI still receives a small score so a large,
 * urgent growth opportunity can outrank it through the other criteria.
 */
export function scoreRoi(roiBps: number): number {
  if (!Number.isFinite(roiBps)) return 0;
  if (roiBps < 0) return 100;
  if (roiBps < 2_500) return 85;
  if (roiBps < 5_000) return 65;
  if (roiBps < 10_000) return 45;
  return 25;
}

/** Potential revenue score, with thresholds expressed in integer BRL cents. */
export function scorePotentialRevenue(potentialRevenueCents: number): number {
  const cents = Math.max(
    0,
    Math.round(Number.isFinite(potentialRevenueCents) ? potentialRevenueCents : 0),
  );
  if (cents >= 5_000_000) return 100; // R$ 50k+
  if (cents >= 2_000_000) return 85; // R$ 20k+
  if (cents >= 500_000) return 65; // R$ 5k+
  if (cents >= 100_000) return 45; // R$ 1k+
  if (cents > 0) return 25;
  return 0;
}

/**
 * Weighted executive priority:
 *   ROI 30% · potential revenue 35% · urgency 20% · trend 15%.
 *
 * Same inputs always produce the same enum; no model output, randomness or
 * tenant data is read here.
 */
export function calculatePriorityBreakdown(criteria: PriorityCriteria): PriorityBreakdown {
  const roi = scoreRoi(criteria.roiBps);
  const revenue = scorePotentialRevenue(criteria.potentialRevenueCents);
  const urgency = clamp(criteria.urgency);
  const trend = clamp(criteria.trendScore);
  const score = Math.round(roi * 0.3 + revenue * 0.35 + urgency * 0.2 + trend * 0.15);
  const priority: DecisionPriorityName =
    score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";

  return { roi, revenue, urgency, trend, score, priority };
}

export function calculatePriority(criteria: PriorityCriteria): DecisionPriorityName {
  return calculatePriorityBreakdown(criteria).priority;
}

export const DECISION_PRIORITY_RANK: Record<DecisionPriorityName, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};
