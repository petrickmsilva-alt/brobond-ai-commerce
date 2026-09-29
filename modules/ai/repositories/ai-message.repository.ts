import "server-only";
import type { AIGeneratedMessage, AiMessageTone, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId, scopedWhere, tenantWhere } from "@/lib/tenant";

export type AiMessageDatabase = Pick<PrismaClient, "aIGeneratedMessage">;

export interface CreateAiMessageInput {
  creatorUserId?: string | null;
  creatorProfileId: string;
  productId: string;
  campaignId: string;
  tone: AiMessageTone;
  promptVersion: string;
  contextHash: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  content: Prisma.InputJsonValue;
  /**
   * PR007.1 — AI Context Audit: stable snapshot of the full structured
   * context (`serializeContext()` output). Required for every new row so
   * the audit trail is complete from PR007.1 onwards; the DB column stays
   * nullable only to accommodate pre-PR007.1 rows.
   */
  contextSnapshot: Prisma.InputJsonValue;
}

/**
 * PR007.1 — an `AIGeneratedMessage` row guaranteed to carry every audit
 * field the /dashboard/ai "Ver contexto" modal renders: the persisted
 * `contextSnapshot` plus the related creator/product/campaign names used
 * as a fallback for rows generated before PR007.1 (whose snapshot is null).
 */
export type AiMessageWithContext = Prisma.AIGeneratedMessageGetPayload<{
  include: { creatorProfile: true; product: true; campaign: true };
}>;

export interface AiMessageListOptions {
  tone?: AiMessageTone;
  page?: number;
  pageSize?: number;
}

export interface AiMessageKpis {
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byTone: Partial<Record<AiMessageTone, number>>;
}

/**
 * Repository for `AIGeneratedMessage` — see `lib/tenant.ts` for the mandatory
 * tenant-scoping pattern every method here follows.
 */
export function createAiMessageRepository(db: AiMessageDatabase) {
  return {
    /**
     * Find a previously generated message for the exact same context (the
     * cache lookup implementing PR007's "never regenerate for an identical
     * context" contract). Returns `null` on a cache miss.
     */
    async findByContextHash(
      organizationId: string,
      contextHash: string,
    ): Promise<AIGeneratedMessage | null> {
      return db.aIGeneratedMessage.findUnique({
        where: {
          organizationId_contextHash: {
            organizationId: assertOrganizationId(organizationId),
            contextHash,
          },
        },
      });
    },

    async create(organizationId: string, data: CreateAiMessageInput): Promise<AIGeneratedMessage> {
      return db.aIGeneratedMessage.create({
        data: { ...data, ...tenantWhere(organizationId) },
      });
    },

    async findById(organizationId: string, id: string): Promise<AIGeneratedMessage | null> {
      return db.aIGeneratedMessage.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    /**
     * PR007.1 — AI Context Audit: fetch a message together with its
     * persisted `contextSnapshot` (and the creator/product/campaign
     * relations as a legacy fallback). Tenant-scoped: a message from
     * another organization is indistinguishable from a missing one.
     */
    async findWithContext(
      organizationId: string,
      id: string,
    ): Promise<AiMessageWithContext | null> {
      return db.aIGeneratedMessage.findFirst({
        where: scopedWhere(organizationId, { id }),
        include: { creatorProfile: true, product: true, campaign: true },
      });
    },

    async list(organizationId: string, options: AiMessageListOptions = {}) {
      const page = options.page ?? 1;
      const pageSize = options.pageSize ?? 20;
      const filters: Prisma.AIGeneratedMessageWhereInput = options.tone
        ? { tone: options.tone }
        : {};
      const where = scopedWhere(organizationId, filters);
      const [items, total] = await Promise.all([
        db.aIGeneratedMessage.findMany({
          where,
          include: { creatorProfile: true, product: true, campaign: true },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.aIGeneratedMessage.count({ where }),
      ]);
      return { items, total, page, pageSize };
    },

    async kpis(organizationId: string): Promise<AiMessageKpis> {
      const where = tenantWhere(organizationId);
      const [aggregate, grouped] = await Promise.all([
        db.aIGeneratedMessage.aggregate({
          where,
          _count: { _all: true },
          _sum: { inputTokens: true, outputTokens: true },
        }),
        db.aIGeneratedMessage.groupBy({
          by: ["tone"],
          where,
          _count: { _all: true },
        }),
      ]);

      const byTone = grouped.reduce<Partial<Record<AiMessageTone, number>>>((acc, row) => {
        acc[row.tone] = row._count._all;
        return acc;
      }, {});

      return {
        totalMessages: aggregate._count._all,
        totalInputTokens: aggregate._sum.inputTokens ?? 0,
        totalOutputTokens: aggregate._sum.outputTokens ?? 0,
        byTone,
      };
    },
  };
}

export const aiMessageRepository = createAiMessageRepository(prisma);
