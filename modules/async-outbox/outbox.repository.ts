import "server-only";

import type { OutboxEvent, Prisma, PrismaClient } from "@prisma/client";
import { assertOrganizationId } from "@/lib/tenant";

export type OutboxTransaction = Pick<Prisma.TransactionClient, "outboxEvent">;
export type OutboxDatabase = Pick<PrismaClient, "outboxEvent">;

export interface CreateOutboxEventInput {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
  availableAt?: Date;
}

export interface ClaimedOutboxEvent {
  event: OutboxEvent;
  claimed: boolean;
}

const cleanError = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 1_000) : "Unknown worker error";

export function createTransactionalOutboxRepository(db: OutboxDatabase) {
  return {
    /**
     * Call this with the domain mutation's TransactionClient so the event
     * cannot be committed independently from the mutation it describes.
     */
    create(tx: OutboxTransaction, organizationId: string, input: CreateOutboxEventInput) {
      const organization = assertOrganizationId(organizationId);
      return tx.outboxEvent.upsert({
        where: {
          organizationId_idempotencyKey: {
            organizationId: organization,
            idempotencyKey: input.idempotencyKey,
          },
        },
        create: {
          organizationId: organization,
          topic: input.topic,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          availableAt: input.availableAt,
        },
        update: {},
      });
    },

    async claimNext(now = new Date()): Promise<ClaimedOutboxEvent | null> {
      const candidate = await db.outboxEvent.findFirst({
        where: {
          status: { in: ["PENDING", "FAILED"] },
          availableAt: { lte: now },
        },
        orderBy: { availableAt: "asc" },
      });
      if (!candidate) return null;

      const claimed = await db.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          status: { in: ["PENDING", "FAILED"] },
          availableAt: { lte: now },
        },
        data: {
          status: "PROCESSING",
          lockedAt: now,
          attempts: { increment: 1 },
          lastError: null,
        },
      });
      if (claimed.count === 0) return { event: candidate, claimed: false };
      const event = await db.outboxEvent.findUniqueOrThrow({ where: { id: candidate.id } });
      return { event, claimed: true };
    },

    markProcessed(id: string, now = new Date()) {
      return db.outboxEvent.updateMany({
        where: { id, status: "PROCESSING" },
        data: { status: "PROCESSED", processedAt: now, lockedAt: null, lastError: null },
      });
    },

    retry(id: string, error: unknown, availableAt: Date) {
      return db.outboxEvent.updateMany({
        where: { id, status: "PROCESSING" },
        data: {
          status: "FAILED",
          lockedAt: null,
          availableAt,
          lastError: cleanError(error),
        },
      });
    },

    fail(id: string, error: unknown) {
      return db.outboxEvent.updateMany({
        where: { id, status: "PROCESSING" },
        data: { status: "FAILED", lockedAt: null, lastError: cleanError(error) },
      });
    },
  };
}
