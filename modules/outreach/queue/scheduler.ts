import "server-only";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";

export interface OutreachSchedulerResult {
  status: "completed" | "failed";
  ready: number;
  executedAt: Date;
  error?: string;
}

/**
 * Promotes due scheduled messages to READY. PR004 never transmits messages;
 * an external delivery adapter may consume READY records in a future PR.
 */
export function createOutreachScheduler(db: Pick<PrismaClient, "outreachMessage">) {
  return {
    async execute(organizationId: string, now = new Date()): Promise<OutreachSchedulerResult> {
      const tenant = tenantWhere(organizationId);
      try {
        const result = await db.outreachMessage.updateMany({
          where: {
            ...tenant,
            status: "SCHEDULED",
            scheduledFor: { lte: now },
          },
          data: { status: "READY" },
        });
        return { status: "completed", ready: result.count, executedAt: now };
      } catch (error) {
        return {
          status: "failed",
          ready: 0,
          executedAt: now,
          error: error instanceof Error ? error.message : "Unknown scheduler error",
        };
      }
    },
  };
}

export const outreachScheduler = createOutreachScheduler(prisma);
