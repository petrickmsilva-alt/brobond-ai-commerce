import "server-only";
import type { OutreachMessage, OutreachStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { CreateMessageDTO } from "../dto/create-message.dto";

export type OutboxDatabase = Pick<PrismaClient, "outreachMessage">;

export interface OutboxListOptions {
  status?: OutreachStatus;
  page?: number;
  pageSize?: number;
}

export interface OutboxStats {
  DRAFT: number;
  READY: number;
  SCHEDULED: number;
  SENT: number;
  FAILED: number;
  CANCELLED: number;
}

const emptyStats = (): OutboxStats => ({
  DRAFT: 0,
  READY: 0,
  SCHEDULED: 0,
  SENT: 0,
  FAILED: 0,
  CANCELLED: 0,
});

export function createOutboxRepository(db: OutboxDatabase) {
  return {
    async createDraft(organizationId: string, data: CreateMessageDTO): Promise<OutreachMessage> {
      return db.outreachMessage.create({
        data: { ...data, ...tenantWhere(organizationId), status: "DRAFT" },
      });
    },

    async updateDraft(
      organizationId: string,
      id: string,
      generatedText: string,
    ): Promise<OutreachMessage | null> {
      const filters: Prisma.OutreachMessageWhereInput = {
        id,
        status: { in: ["DRAFT", "READY"] },
      };
      const where = scopedWhere(organizationId, filters);
      const result = await db.outreachMessage.updateMany({ where, data: { generatedText } });
      if (result.count === 0) return null;
      return db.outreachMessage.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    async scheduleMessage(
      organizationId: string,
      id: string,
      scheduledFor: Date,
    ): Promise<OutreachMessage | null> {
      if (scheduledFor.getTime() <= Date.now())
        throw new RangeError("scheduledFor must be future.");
      const filters: Prisma.OutreachMessageWhereInput = {
        id,
        status: { in: ["DRAFT", "READY"] },
      };
      const where = scopedWhere(organizationId, filters);
      const result = await db.outreachMessage.updateMany({
        where,
        data: { status: "SCHEDULED", scheduledFor },
      });
      if (result.count === 0) return null;
      return db.outreachMessage.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    async cancelMessage(organizationId: string, id: string): Promise<OutreachMessage | null> {
      const filters: Prisma.OutreachMessageWhereInput = {
        id,
        status: { in: ["DRAFT", "READY", "SCHEDULED"] },
      };
      const where = scopedWhere(organizationId, filters);
      const result = await db.outreachMessage.updateMany({
        where,
        data: { status: "CANCELLED", scheduledFor: null },
      });
      if (result.count === 0) return null;
      return db.outreachMessage.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    async listOutbox(organizationId: string, options: OutboxListOptions = {}) {
      const page = options.page ?? 1;
      const pageSize = options.pageSize ?? 50;
      const filters: Prisma.OutreachMessageWhereInput = options.status
        ? { status: options.status }
        : {};
      const where = scopedWhere(organizationId, filters);
      const [items, total] = await Promise.all([
        db.outreachMessage.findMany({
          where,
          include: { creator: true, product: true, campaign: true, template: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.outreachMessage.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },

    async stats(organizationId: string): Promise<OutboxStats> {
      const grouped = await db.outreachMessage.groupBy({
        by: ["status"],
        where: tenantWhere(organizationId),
        _count: { _all: true },
      });
      return grouped.reduce((result, row) => {
        result[row.status] = row._count._all;
        return result;
      }, emptyStats());
    },
  };
}

export const outboxRepository = createOutboxRepository(prisma);
