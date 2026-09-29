import "server-only";

import type { AIDecision, DecisionStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId, scopedWhere, tenantWhere } from "@/lib/tenant";
import { assertDecisionTransition } from "../engine/decision.engine";
import { DECISION_PRIORITY_RANK } from "../engine/priority.engine";
import type {
  AICeoDashboardDTO,
  AIDecisionDTO,
  AIDecisionDraft,
  DecisionPriorityName,
  DecisionStatusName,
  ExecutiveContext,
} from "../dto";

export type AICeoDatabase = Pick<
  PrismaClient,
  "aIDecisionRun" | "aIDecision" | "executiveReport" | "auditLog" | "$transaction"
>;

export class DecisionNotFoundError extends Error {
  constructor() {
    super("AI decision was not found in this organization.");
    this.name = "DecisionNotFoundError";
  }
}

export interface PersistDecisionGenerationInput {
  context: ExecutiveContext;
  decisions: readonly AIDecisionDraft[];
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  rawResponse: unknown;
  actorId: string;
}

export interface PersistExecutiveReportInput {
  context: ExecutiveContext;
  summary: string;
  risks: string[];
  opportunities: string[];
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  rawResponse: unknown;
  actorId: string;
  now?: Date;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function actorFromMetadata(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("actorId" in value)) return null;
  const actorId = (value as { actorId?: unknown }).actorId;
  return typeof actorId === "string" ? actorId : null;
}

function toDecisionDTO(
  decision: AIDecision & {
    evidence: Array<{
      id: string;
      sourceType: string;
      sourceId: string;
      weight: number;
      createdAt: Date;
    }>;
  },
): AIDecisionDTO {
  return {
    id: decision.id,
    title: decision.title,
    description: decision.description,
    reason: decision.reason,
    priority: decision.priority as DecisionPriorityName,
    status: decision.status as DecisionStatusName,
    confidence: decision.confidence,
    category: decision.category,
    potentialRevenueCents: decision.potentialRevenueCents,
    createdAt: decision.createdAt.toISOString(),
    approvedAt: decision.approvedAt?.toISOString() ?? null,
    rejectedAt: decision.rejectedAt?.toISOString() ?? null,
    executedAt: decision.executedAt?.toISOString() ?? null,
    evidence: decision.evidence.map((evidence) => ({
      id: evidence.id,
      sourceType: evidence.sourceType,
      sourceId: evidence.sourceId,
      weight: evidence.weight,
      createdAt: evidence.createdAt.toISOString(),
    })),
  };
}

export function createAICeoRepository(db: AICeoDatabase) {
  return {
    /** Persist the raw response and every derived PENDING decision atomically. */
    async persistGeneration(organizationId: string, input: PersistDecisionGenerationInput) {
      const organization = assertOrganizationId(organizationId);
      return db.$transaction(async (tx) => {
        const run = await tx.aIDecisionRun.create({
          data: {
            organizationId: organization,
            promptVersion: input.promptVersion,
            model: input.model,
            temperature: input.temperature,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            inputSnapshot: json(input.context),
            rawResponse: json(input.rawResponse),
            decisions: {
              create: input.decisions.map((decision) => ({
                organizationId: organization,
                title: decision.title,
                description: decision.description,
                reason: decision.reason,
                priority: decision.priority,
                status: "PENDING",
                confidence: decision.confidence,
                category: decision.category,
                sourceKey: decision.sourceKey,
                potentialRevenueCents: decision.potentialRevenueCents,
                evidence: {
                  create: decision.evidence.map((evidence) => ({
                    sourceType: evidence.sourceType,
                    sourceId: evidence.sourceId,
                    weight: evidence.weight,
                  })),
                },
              })),
            },
          },
          include: { decisions: { include: { evidence: true } } },
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization,
            action: "AI_CEO_DECISIONS_GENERATED",
            entityType: "AIDecisionRun",
            entityId: run.id,
            metadata: json({
              actorId: input.actorId,
              promptVersion: input.promptVersion,
              decisions: run.decisions.length,
            }),
          },
        });
        return run;
      });
    },

    /**
     * Human-only lifecycle transition. EXECUTED is an audit acknowledgement;
     * this transaction deliberately has no campaign/outreach/delivery writes.
     */
    async transition(
      organizationId: string,
      decisionId: string,
      target: Exclude<DecisionStatusName, "PENDING">,
      actorId: string,
      now = new Date(),
    ): Promise<AIDecision> {
      const organization = assertOrganizationId(organizationId);
      return db.$transaction(async (tx) => {
        const current = await tx.aIDecision.findFirst({
          where: scopedWhere(organization, { id: decisionId }),
        });
        if (!current) throw new DecisionNotFoundError();
        assertDecisionTransition(current.status as DecisionStatusName, target);

        const timestamp =
          target === "APPROVED"
            ? { approvedAt: now }
            : target === "REJECTED"
              ? { rejectedAt: now }
              : { executedAt: now };
        const updated = await tx.aIDecision.update({
          where: { id: current.id },
          data: { status: target as DecisionStatus, ...timestamp },
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization,
            action: `AI_DECISION_${target}`,
            entityType: "AIDecision",
            entityId: current.id,
            metadata: json({ actorId, from: current.status, to: target }),
          },
        });
        return updated;
      });
    },

    async persistReport(organizationId: string, input: PersistExecutiveReportInput) {
      const organization = assertOrganizationId(organizationId);
      const now = input.now ?? new Date();
      const reportDate = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      return db.$transaction(async (tx) => {
        const report = await tx.executiveReport.create({
          data: {
            organizationId: organization,
            reportDate,
            summary: input.summary,
            gmvCents: input.context.analytics.gmvCents,
            roiBps: input.context.analytics.roiBps,
            creators: input.context.creators.length,
            products: input.context.products.length,
            campaigns: input.context.campaigns.length,
            risks: json(input.risks),
            opportunities: json(input.opportunities),
            promptVersion: input.promptVersion,
            model: input.model,
            temperature: input.temperature,
            inputTokens: input.inputTokens,
            outputTokens: input.outputTokens,
            inputSnapshot: json(input.context),
            rawResponse: json(input.rawResponse),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization,
            action: "AI_CEO_REPORT_GENERATED",
            entityType: "ExecutiveReport",
            entityId: report.id,
            metadata: json({ actorId: input.actorId, promptVersion: input.promptVersion }),
          },
        });
        return report;
      });
    },

    async dashboard(organizationId: string): Promise<AICeoDashboardDTO> {
      const organization = assertOrganizationId(organizationId);
      const activeStatuses: DecisionStatus[] = ["PENDING", "APPROVED"];
      const [opportunities, potential, pending, critical, rows, logs, report] = await Promise.all([
        db.aIDecision.count({
          where: {
            ...tenantWhere(organization),
            status: { in: activeStatuses },
            potentialRevenueCents: { gt: 0 },
          },
        }),
        db.aIDecision.aggregate({
          where: { ...tenantWhere(organization), status: { in: activeStatuses } },
          _sum: { potentialRevenueCents: true },
        }),
        db.aIDecision.count({
          where: { ...tenantWhere(organization), status: "PENDING" },
        }),
        db.aIDecision.count({
          where: {
            ...tenantWhere(organization),
            status: { in: activeStatuses },
            priority: "CRITICAL",
          },
        }),
        db.aIDecision.findMany({
          where: tenantWhere(organization),
          include: { evidence: { orderBy: { weight: "desc" } } },
          orderBy: { createdAt: "desc" },
          take: 50,
        }),
        db.auditLog.findMany({
          where: {
            ...tenantWhere(organization),
            OR: [{ action: { startsWith: "AI_CEO_" } }, { action: { startsWith: "AI_DECISION_" } }],
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
        db.executiveReport.findFirst({
          where: tenantWhere(organization),
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const decisions = rows
        .sort(
          (left, right) =>
            DECISION_PRIORITY_RANK[right.priority as DecisionPriorityName] -
              DECISION_PRIORITY_RANK[left.priority as DecisionPriorityName] ||
            right.potentialRevenueCents - left.potentialRevenueCents ||
            right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, 5)
        .map(toDecisionDTO);

      return {
        kpis: {
          opportunities,
          potentialRevenueCents: potential._sum.potentialRevenueCents ?? 0,
          pending,
          critical,
        },
        decisions,
        timeline: logs.map((log) => ({
          id: log.id,
          action: log.action,
          decisionId: log.entityType === "AIDecision" ? log.entityId : null,
          actorId: actorFromMetadata(log.metadata),
          createdAt: log.createdAt.toISOString(),
        })),
        latestReport: report
          ? {
              id: report.id,
              reportDate: report.reportDate.toISOString(),
              summary: report.summary,
              gmvCents: report.gmvCents,
              roiBps: report.roiBps,
              creators: report.creators,
              products: report.products,
              campaigns: report.campaigns,
              risks: asStringArray(report.risks),
              opportunities: asStringArray(report.opportunities),
              promptVersion: report.promptVersion,
              createdAt: report.createdAt.toISOString(),
            }
          : null,
      };
    },
  };
}

export const aiCeoRepository = createAICeoRepository(prisma);
