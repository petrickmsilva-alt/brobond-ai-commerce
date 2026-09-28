import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { log, sanitizeLogData } from "@/lib/observability/logger";
import { assertOrganizationId } from "@/lib/tenant";

export class AIGovernanceError extends Error {
  constructor(
    readonly code:
      | "AI_AUTONOMY_DISABLED"
      | "AI_BUDGET_EXCEEDED"
      | "AI_APPROVAL_REQUIRED"
      | "AI_APPROVAL_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "AIGovernanceError";
  }
}

const configSchema = z.object({
  AI_AUTONOMY_ENABLED: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  AI_ORG_RUN_BUDGET_CENTS: z.coerce.number().int().min(0).default(100),
  AI_ORG_PERIOD_BUDGET_CENTS: z.coerce.number().int().min(0).default(1_000),
  AI_BUDGET_PERIOD_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 31)
    .default(24),
});

export interface AIGovernanceConfig {
  enabled: boolean;
  runBudgetCents: number;
  periodBudgetCents: number;
  periodHours: number;
}

export function getAIGovernanceConfig(
  source: Record<string, string | undefined> = process.env,
): AIGovernanceConfig {
  const parsed = configSchema.parse(source);
  return {
    enabled: parsed.AI_AUTONOMY_ENABLED,
    runBudgetCents: parsed.AI_ORG_RUN_BUDGET_CENTS,
    periodBudgetCents: parsed.AI_ORG_PERIOD_BUDGET_CENTS,
    periodHours: parsed.AI_BUDGET_PERIOD_HOURS,
  };
}

type GovernanceDatabase = Pick<PrismaClient, "agentRun" | "agentToolCall" | "approvalRequest">;

const json = (value: unknown): Prisma.InputJsonValue =>
  sanitizeLogData(value) as Prisma.InputJsonValue;

export interface StartAgentRunInput {
  organizationId: string;
  requestId?: string;
  trigger: string;
  model: string;
  input: unknown;
}

export function createAIGovernanceService(
  db: GovernanceDatabase,
  configuration = getAIGovernanceConfig,
) {
  return {
    async startRun(input: StartAgentRunInput) {
      const organizationId = assertOrganizationId(input.organizationId);
      const config = configuration();
      const requestId = input.requestId ?? randomUUID();
      const periodStart = new Date(Date.now() - config.periodHours * 60 * 60 * 1_000);
      const spent = await db.agentRun.aggregate({
        where: {
          organizationId,
          status: "COMPLETED",
          startedAt: { gte: periodStart },
        },
        _sum: { costCents: true },
      });
      const blocked = !config.enabled || (spent._sum.costCents ?? 0) >= config.periodBudgetCents;
      const status = blocked ? "BLOCKED" : "RUNNING";
      const run = await db.agentRun.create({
        data: {
          organizationId,
          requestId,
          trigger: input.trigger,
          model: input.model,
          status,
          safeInput: json(input.input),
          budgetCents: config.runBudgetCents,
          completedAt: blocked ? new Date() : null,
          lastError: blocked
            ? !config.enabled
              ? "Global AI autonomy kill switch is disabled."
              : "Organization AI period budget has been exhausted."
            : null,
        },
      });
      if (!config.enabled) {
        throw new AIGovernanceError(
          "AI_AUTONOMY_DISABLED",
          "AI execution is disabled by the global autonomy kill switch.",
        );
      }
      if (blocked) {
        throw new AIGovernanceError(
          "AI_BUDGET_EXCEEDED",
          "Organization AI period budget has been exhausted.",
        );
      }
      return run;
    },

    async completeRun(
      organizationId: string,
      runId: string,
      result: { output: unknown; inputTokens: number; outputTokens: number; costCents: number },
    ) {
      const config = configuration();
      if (result.costCents > config.runBudgetCents) {
        await db.agentRun.updateMany({
          where: { id: runId, organizationId, status: "RUNNING" },
          data: {
            status: "BLOCKED",
            completedAt: new Date(),
            lastError: "AI execution exceeded its per-run budget.",
          },
        });
        throw new AIGovernanceError(
          "AI_BUDGET_EXCEEDED",
          "AI execution exceeded its per-run budget.",
        );
      }
      return db.agentRun.updateMany({
        where: {
          id: runId,
          organizationId: assertOrganizationId(organizationId),
          status: "RUNNING",
        },
        data: {
          status: "COMPLETED",
          safeOutput: json(result.output),
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costCents: result.costCents,
          completedAt: new Date(),
        },
      });
    },

    async failRun(organizationId: string, runId: string, error: unknown) {
      return db.agentRun.updateMany({
        where: {
          id: runId,
          organizationId: assertOrganizationId(organizationId),
          status: "RUNNING",
        },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          lastError: String(sanitizeLogData(error)).slice(0, 1_000),
        },
      });
    },

    async recordToolCall(input: {
      organizationId: string;
      agentRunId: string;
      tool: string;
      toolInput: unknown;
      externalEffect: boolean;
      approvalRequestId?: string;
    }) {
      const organizationId = assertOrganizationId(input.organizationId);
      if (input.externalEffect) {
        if (!input.approvalRequestId) {
          throw new AIGovernanceError(
            "AI_APPROVAL_REQUIRED",
            "External-effect tools require an approved human ApprovalRequest.",
          );
        }
        const approval = await db.approvalRequest.findFirst({
          where: {
            id: input.approvalRequestId,
            organizationId,
            agentRunId: input.agentRunId,
            status: "APPROVED",
          },
        });
        if (!approval) {
          throw new AIGovernanceError(
            "AI_APPROVAL_REQUIRED",
            "External-effect tools require an approved human ApprovalRequest.",
          );
        }
      }
      return db.agentToolCall.create({
        data: {
          agentRunId: input.agentRunId,
          tool: input.tool,
          safeInput: json(input.toolInput),
          status: "PENDING",
        },
      });
    },

    async requestApproval(input: {
      organizationId: string;
      agentRunId?: string;
      proposedAction: string;
      risk: string;
      requestedById?: string;
    }) {
      return db.approvalRequest.create({
        data: {
          ...input,
          organizationId: assertOrganizationId(input.organizationId),
          status: "PENDING",
        },
      });
    },

    async resolveApproval(
      organizationId: string,
      approvalId: string,
      actorId: string,
      approved: boolean,
    ) {
      return db.approvalRequest.updateMany({
        where: {
          id: approvalId,
          organizationId: assertOrganizationId(organizationId),
          status: "PENDING",
        },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          resolvedById: actorId,
          resolvedAt: new Date(),
        },
      });
    },

    logBlockedExternalEffect(organizationId: string, tool: string) {
      log({
        event: "AI_EXTERNAL_EFFECT_BLOCKED",
        level: "warn",
        context: { organizationId, tool },
      });
    },
  };
}
