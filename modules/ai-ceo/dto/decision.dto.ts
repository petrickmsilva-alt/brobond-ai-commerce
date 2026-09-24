import type { ExecutiveContext } from "./executive-context.dto";

export const DECISION_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type DecisionPriorityName = (typeof DECISION_PRIORITIES)[number];

export const DECISION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXECUTED"] as const;
export type DecisionStatusName = (typeof DECISION_STATUSES)[number];

export interface PriorityCriteria {
  /** Actual or projected ROI in basis points; negative values represent losses. */
  roiBps: number;
  /** Incremental revenue that could be captured, in integer cents. */
  potentialRevenueCents: number;
  /** Time sensitivity, normalized to 0..100. */
  urgency: number;
  /** Trend/momentum strength, normalized to 0..100. */
  trendScore: number;
}

export interface DecisionEvidenceInput {
  sourceType: string;
  sourceId: string;
  /** Relative contribution to the recommendation, normalized to 0..1. */
  weight: number;
}

export type RevenueOpportunityType =
  | "HIGH_MARGIN_LOW_CREATORS"
  | "GROWING_TREND_NO_CAMPAIGN"
  | "PREMIUM_CREATOR_NO_CONTACT"
  | "CAMPAIGN_ROI_BELOW_TARGET"
  | "DELIVERY_FAILURE_RISK"
  | "OUTREACH_BACKLOG";

export interface RevenueOpportunity {
  /** Stable key supplied to OpenAI and required back in its response. */
  key: string;
  type: RevenueOpportunityType;
  category: string;
  title: string;
  description: string;
  reason: string;
  confidence: number;
  criteria: PriorityCriteria;
  evidence: DecisionEvidenceInput[];
}

/** Untrusted structured recommendation returned by OpenAI after Zod validation. */
export interface AIExecutiveRecommendation {
  opportunityKey: string;
  title: string;
  description: string;
  reason: string;
  confidence: number;
}

/** Safe decision payload persisted by the repository. */
export interface AIDecisionDraft {
  sourceKey: string;
  title: string;
  description: string;
  reason: string;
  priority: DecisionPriorityName;
  status: "PENDING";
  confidence: number;
  category: string;
  potentialRevenueCents: number;
  evidence: DecisionEvidenceInput[];
}

export interface ExecutiveStrategyResponse {
  summary: string;
  decisions: AIExecutiveRecommendation[];
}

export interface ExecutiveGenerationResult {
  context: ExecutiveContext;
  opportunities: RevenueOpportunity[];
  decisions: AIDecisionDraft[];
  strategy: ExecutiveStrategyResponse;
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  rawResponse: unknown;
}

export interface AIDecisionDTO {
  id: string;
  title: string;
  description: string;
  reason: string;
  priority: DecisionPriorityName;
  status: DecisionStatusName;
  confidence: number;
  category: string;
  potentialRevenueCents: number;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  executedAt: string | null;
  evidence: Array<DecisionEvidenceInput & { id: string; createdAt: string }>;
}

export interface ExecutiveReportDTO {
  id: string;
  reportDate: string;
  summary: string;
  gmvCents: number;
  roiBps: number;
  creators: number;
  products: number;
  campaigns: number;
  risks: string[];
  opportunities: string[];
  promptVersion: string;
  createdAt: string;
}

export interface AICeoTimelineItemDTO {
  id: string;
  action: string;
  decisionId: string | null;
  actorId: string | null;
  createdAt: string;
}

export interface AICeoDashboardDTO {
  kpis: {
    opportunities: number;
    potentialRevenueCents: number;
    pending: number;
    critical: number;
  };
  decisions: AIDecisionDTO[];
  timeline: AICeoTimelineItemDTO[];
  latestReport: ExecutiveReportDTO | null;
}
