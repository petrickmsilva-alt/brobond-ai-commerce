import "server-only";

import type {
  DeliveryAccount,
  DeliveryAccountStatus,
  DeliveryChannel,
  DeliveryMessage,
  DeliveryStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId, tenantWhere } from "@/lib/tenant";
import { isForwardProgress, type DeliveryStatusName } from "../core/delivery.interface";

/**
 * Delivery repository (PR010) — the ONLY persistence boundary of the
 * omnichannel engine.
 *
 * TENANT CONTRACT: every method takes `organizationId` as its first
 * argument and scopes every Prisma call to it, except
 * `findAccountByProviderAccountId` — a deliberately GLOBAL lookup used by
 * inbound webhooks to resolve the tenant from the globally-unique provider
 * `accountId` (Instagram Business id / WhatsApp phone number id). No other
 * method may bypass the tenant boundary.
 */

export type DeliveryDatabase = Pick<
  PrismaClient,
  "deliveryAccount" | "deliveryMessage" | "deliveryOAuthState" | "auditLog"
>;

const accountSafeSelect = {
  id: true,
  organizationId: true,
  channel: true,
  accountId: true,
  accountName: true,
  expiresAt: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DeliveryAccountSelect;

export type DeliveryAccountSafeRow = Prisma.DeliveryAccountGetPayload<{
  select: typeof accountSafeSelect;
}>;

export interface ConnectedAccountInput {
  channel: DeliveryChannel;
  accountId: string;
  accountName?: string | null;
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  expiresAt: Date | null;
}

export interface EncryptedTokenSet {
  encryptedAccessToken: string | null;
  encryptedRefreshToken: string | null;
  expiresAt: Date | null;
}

export interface EnqueueMessageInput {
  executionId: string;
  channel: DeliveryChannel;
  recipientId: string;
  recipientName?: string | null;
  payload: Prisma.InputJsonValue;
  queuedAt?: Date;
}

export interface DeliveryMessageFilters {
  channel?: DeliveryChannel;
  status?: DeliveryStatus;
  /** Matches the denormalized `payload.campaignId` JSON field. */
  campaignId?: string;
  page?: number;
  pageSize?: number;
}

export interface DeliveryUsageAggregate {
  messagesSent: number;
  messagesDelivered: number;
  messagesRead: number;
  messagesFailed: number;
  messagesQueued: number;
}

/** Prisma unique-constraint violation (used for idempotent writes). */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"
  );
}

export function createDeliveryRepository(db: DeliveryDatabase) {
  return {
    // --------------------------------------------------------------
    // Accounts
    // --------------------------------------------------------------

    /** Idempotent connect: one row per (tenant, channel, provider account). */
    async upsertConnectedAccount(
      organizationId: string,
      input: ConnectedAccountInput,
    ): Promise<DeliveryAccount> {
      const scope = tenantWhere(organizationId);
      return db.deliveryAccount.upsert({
        where: {
          organizationId_channel_accountId: {
            organizationId: scope.organizationId,
            channel: input.channel,
            accountId: input.accountId,
          },
        },
        create: {
          organizationId: scope.organizationId,
          channel: input.channel,
          accountId: input.accountId,
          accountName: input.accountName ?? null,
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          expiresAt: input.expiresAt,
          status: "CONNECTED",
        },
        update: {
          accountName: input.accountName ?? null,
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken,
          expiresAt: input.expiresAt,
          status: "CONNECTED",
        },
      });
    },

    /**
     * GLOBAL lookup — webhook tenant resolution only. `accountId` is
     * globally unique by schema, so a webhook payload can resolve at most
     * one tenant. Callers MUST re-scope all subsequent queries.
     */
    async findAccountByProviderAccountId(accountId: string): Promise<DeliveryAccount | null> {
      if (!accountId) return null;
      return db.deliveryAccount.findUnique({ where: { accountId } });
    },

    /** The send-ready CONNECTED account of a tenant for one channel. */
    async findActiveAccount(
      organizationId: string,
      channel: DeliveryChannel,
    ): Promise<DeliveryAccount | null> {
      return db.deliveryAccount.findFirst({
        where: { ...tenantWhere(organizationId), channel, status: "CONNECTED" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      });
    },

    /** Tenant-scoped account fetch by primary key (includes ciphertext —
     * callers must be server-only services). */
    async findAccountById(
      organizationId: string,
      accountPk: string,
    ): Promise<DeliveryAccount | null> {
      return db.deliveryAccount.findFirst({
        where: { id: accountPk, ...tenantWhere(organizationId) },
      });
    },

    /** Credential-free account list for the dashboard (never ciphertext). */
    async listAccounts(organizationId: string): Promise<DeliveryAccountSafeRow[]> {
      return db.deliveryAccount.findMany({
        where: tenantWhere(organizationId),
        select: accountSafeSelect,
        orderBy: [{ channel: "asc" }, { createdAt: "asc" }],
      });
    },

    async saveTokens(
      organizationId: string,
      accountPk: string,
      tokens: EncryptedTokenSet,
    ): Promise<number> {
      const result = await db.deliveryAccount.updateMany({
        where: { id: accountPk, ...tenantWhere(organizationId) },
        data: {
          encryptedAccessToken: tokens.encryptedAccessToken,
          encryptedRefreshToken: tokens.encryptedRefreshToken,
          expiresAt: tokens.expiresAt,
          status: "CONNECTED",
        },
      });
      return result.count;
    },

    async markAccountStatus(
      organizationId: string,
      accountPk: string,
      status: DeliveryAccountStatus,
    ): Promise<number> {
      const result = await db.deliveryAccount.updateMany({
        where: { id: accountPk, ...tenantWhere(organizationId) },
        data: { status },
      });
      return result.count;
    },

    /** Local revocation: ciphertext is destroyed, guaranteeing no further
     * provider call can be made with these credentials. */
    async disconnectAccount(organizationId: string, accountPk: string): Promise<boolean> {
      const result = await db.deliveryAccount.updateMany({
        where: { id: accountPk, ...tenantWhere(organizationId) },
        data: {
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          expiresAt: null,
          status: "DISCONNECTED",
        },
      });
      return result.count > 0;
    },

    // --------------------------------------------------------------
    // OAuth state (server-side CSRF guard, single-use)
    // --------------------------------------------------------------

    async createOAuthState(input: {
      organizationId: string;
      channel: DeliveryChannel;
      stateHash: string;
      expiresAt: Date;
    }) {
      return db.deliveryOAuthState.create({ data: input });
    },

    async findOAuthStateByHash(stateHash: string) {
      return db.deliveryOAuthState.findUnique({ where: { stateHash } });
    },

    /** Delete-if-still-valid: a non-1 count means the state was consumed. */
    async consumeOAuthState(id: string, now: Date): Promise<boolean> {
      const result = await db.deliveryOAuthState.deleteMany({
        where: { id, expiresAt: { gt: now } },
      });
      return result.count === 1;
    },

    async purgeExpiredOAuthStates(organizationId: string, now: Date): Promise<number> {
      const result = await db.deliveryOAuthState.deleteMany({
        where: { ...tenantWhere(organizationId), expiresAt: { lte: now } },
      });
      return result.count;
    },

    // --------------------------------------------------------------
    // Messages — queue + lifecycle
    // --------------------------------------------------------------

    /**
     * Idempotent enqueue anchored on (tenant, executionId, channel,
     * recipientId): re-dispatching the same approved execution returns the
     * existing row untouched (`created: false`), never a duplicate send.
     */
    async enqueueMessage(
      organizationId: string,
      input: EnqueueMessageInput,
    ): Promise<{ message: DeliveryMessage; created: boolean }> {
      const scope = tenantWhere(organizationId);
      const unique = {
        organizationId: scope.organizationId,
        executionId: input.executionId,
        channel: input.channel,
        recipientId: input.recipientId,
      };
      const queuedAt = input.queuedAt ?? new Date();
      const existing = await db.deliveryMessage.findUnique({
        where: { organizationId_executionId_channel_recipientId: unique },
      });
      if (existing) return { message: existing, created: false };
      try {
        const message = await db.deliveryMessage.create({
          data: {
            ...unique,
            recipientName: input.recipientName ?? null,
            status: "QUEUED",
            payload: input.payload,
            attempts: 0,
            nextAttemptAt: queuedAt,
          },
        });
        return { message, created: true };
      } catch (error) {
        // Concurrent enqueue of the same idempotency key: the loser reads
        // the winner's row instead of failing.
        if (!isUniqueConstraintError(error)) throw error;
        const raced = await db.deliveryMessage.findUnique({
          where: { organizationId_executionId_channel_recipientId: unique },
        });
        if (raced) return { message: raced, created: false };
        throw error;
      }
    },

    async findMessageById(
      organizationId: string,
      messageId: string,
    ): Promise<DeliveryMessage | null> {
      return db.deliveryMessage.findFirst({
        where: { id: messageId, ...tenantWhere(organizationId) },
      });
    },

    async findByProviderMessageId(
      organizationId: string,
      providerMessageId: string,
    ): Promise<DeliveryMessage | null> {
      return db.deliveryMessage.findFirst({
        where: { ...tenantWhere(organizationId), providerMessageId },
      });
    },

    /** Due queue candidates: QUEUED messages whose scheduled time arrived. */
    async listDispatchCandidates(
      organizationId: string,
      options: { now: Date; limit?: number; channel?: DeliveryChannel },
    ): Promise<DeliveryMessage[]> {
      return db.deliveryMessage.findMany({
        where: {
          ...tenantWhere(organizationId),
          status: "QUEUED",
          ...(options.channel ? { channel: options.channel } : {}),
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: options.now } }],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: options.limit ?? 25,
      });
    },

    /**
     * Optimistic claim: QUEUED → SENDING, consuming one attempt. A `false`
     * result means another worker already claimed (or finished) the row —
     * the dispatcher must skip it. This is the at-least-once send guard.
     */
    async claimMessageForSending(
      organizationId: string,
      messageId: string,
      now: Date,
    ): Promise<boolean> {
      const result = await db.deliveryMessage.updateMany({
        where: { id: messageId, ...tenantWhere(organizationId), status: "QUEUED" },
        data: { status: "SENDING", lastAttemptAt: now, attempts: { increment: 1 } },
      });
      return result.count === 1;
    },

    async markSent(
      organizationId: string,
      messageId: string,
      input: { providerMessageId: string; sentAt: Date },
    ): Promise<number> {
      const result = await db.deliveryMessage.updateMany({
        where: { id: messageId, ...tenantWhere(organizationId), status: "SENDING" },
        data: {
          status: "SENT",
          providerMessageId: input.providerMessageId,
          sentAt: input.sentAt,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      return result.count;
    },

    /** Retry re-queue: stays in QUEUED with a fresh backoff deadline. */
    async scheduleRetry(
      organizationId: string,
      messageId: string,
      input: { nextAttemptAt: Date; lastError: string },
    ): Promise<number> {
      const result = await db.deliveryMessage.updateMany({
        where: { id: messageId, ...tenantWhere(organizationId), status: "SENDING" },
        data: {
          status: "QUEUED",
          nextAttemptAt: input.nextAttemptAt,
          lastError: input.lastError,
        },
      });
      return result.count;
    },

    async markFailed(
      organizationId: string,
      messageId: string,
      input: { lastError: string },
    ): Promise<number> {
      const result = await db.deliveryMessage.updateMany({
        where: { id: messageId, ...tenantWhere(organizationId), status: "SENDING" },
        data: { status: "FAILED", nextAttemptAt: null, lastError: input.lastError },
      });
      return result.count;
    },

    /** ADMIN reprocess: FAILED/CANCELLED → QUEUED with a clean retry budget. */
    async requeueMessage(organizationId: string, messageId: string, now: Date): Promise<number> {
      const result = await db.deliveryMessage.updateMany({
        where: {
          id: messageId,
          ...tenantWhere(organizationId),
          status: { in: ["FAILED", "CANCELLED"] },
        },
        data: { status: "QUEUED", attempts: 0, nextAttemptAt: now, lastError: null },
      });
      return result.count;
    },

    /**
     * Webhook receipt application: moves the message FORWARD to `target`
     * (SENT/DELIVERED/READ) with its timestamp. Idempotent — a duplicate or
     * out-of-order receipt never regresses the lifecycle and reports
     * `applied: false`.
     */
    async applyProviderReceipt(
      organizationId: string,
      input: { providerMessageId: string; target: DeliveryStatusName; at: Date },
    ): Promise<{ applied: boolean; message: DeliveryMessage | null }> {
      const message = await this.findByProviderMessageId(organizationId, input.providerMessageId);
      if (!message) return { applied: false, message: null };
      if (!isForwardProgress(message.status as DeliveryStatusName, input.target)) {
        return { applied: false, message };
      }
      const timestampField =
        input.target === "READ"
          ? "readAt"
          : input.target === "DELIVERED"
            ? "deliveredAt"
            : "sentAt";
      await db.deliveryMessage.updateMany({
        where: { id: message.id, ...tenantWhere(organizationId), status: message.status },
        data: { status: input.target as DeliveryStatus, [timestampField]: input.at },
      });
      return { applied: true, message };
    },

    /**
     * Provider failure receipt: a `failed` status webhook marks the message
     * FAILED (legal from QUEUED/SENDING/SENT per the transition map). A
     * message already DELIVERED/READ never regresses. Idempotent.
     */
    async applyProviderFailure(
      organizationId: string,
      input: { providerMessageId: string; at: Date; lastError: string },
    ): Promise<{ applied: boolean; message: DeliveryMessage | null }> {
      const scope = tenantWhere(organizationId);
      const message = await this.findByProviderMessageId(
        scope.organizationId,
        input.providerMessageId,
      );
      if (!message) return { applied: false, message: null };
      const failureSources: DeliveryStatus[] = ["QUEUED", "SENDING", "SENT"];
      if (!failureSources.includes(message.status)) return { applied: false, message };
      await db.deliveryMessage.updateMany({
        where: { id: message.id, ...scope, status: message.status },
        data: { status: "FAILED", nextAttemptAt: null, lastError: input.lastError },
      });
      return { applied: true, message };
    },

    // --------------------------------------------------------------
    // Dashboard projections
    // --------------------------------------------------------------

    async listMessages(
      organizationId: string,
      filters: DeliveryMessageFilters = {},
    ): Promise<{ rows: DeliveryMessage[]; total: number }> {
      const page = Math.max(1, filters.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
      const where: Prisma.DeliveryMessageWhereInput = {
        ...tenantWhere(organizationId),
        ...(filters.channel ? { channel: filters.channel } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.campaignId
          ? { payload: { path: ["campaignId"], equals: filters.campaignId } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        db.deliveryMessage.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        db.deliveryMessage.count({ where }),
      ]);
      return { rows, total };
    },

    /** Per-status counters — the single source of the dashboard KPIs. */
    async statusCounts(organizationId: string): Promise<Record<string, number>> {
      const grouped = await db.deliveryMessage.groupBy({
        by: ["status"],
        where: tenantWhere(organizationId),
        _count: { _all: true },
      });
      const counts: Record<string, number> = {};
      for (const row of grouped) counts[row.status] = row._count._all;
      return counts;
    },

    /** Distinct campaigns seen in message payloads (dashboard filter). */
    async listCampaignFacets(
      organizationId: string,
    ): Promise<Array<{ campaignId: string; campaignName: string | null }>> {
      const rows = await db.deliveryMessage.findMany({
        where: tenantWhere(organizationId),
        select: { payload: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const seen = new Map<string, string | null>();
      for (const row of rows) {
        const payload = row.payload as { campaignId?: unknown; campaignName?: unknown } | null;
        const campaignId = typeof payload?.campaignId === "string" ? payload.campaignId : null;
        if (campaignId && !seen.has(campaignId)) {
          seen.set(
            campaignId,
            typeof payload?.campaignName === "string" ? payload.campaignName : null,
          );
        }
      }
      return [...seen.entries()].map(([campaignId, campaignName]) => ({
        campaignId,
        campaignName,
      }));
    },

    // --------------------------------------------------------------
    // Analytics aggregate (PR010 §11)
    // --------------------------------------------------------------

    /** Delivery counters for one UTC period — feeds AnalyticsSnapshot. */
    async aggregateDeliveryUsage(
      organizationId: string,
      range: { from: Date; to: Date },
    ): Promise<DeliveryUsageAggregate> {
      const scope = tenantWhere(organizationId);
      const period = { gte: range.from, lt: range.to };
      const [messagesSent, messagesDelivered, messagesRead, messagesFailed, messagesQueued] =
        await Promise.all([
          db.deliveryMessage.count({ where: { ...scope, sentAt: period } }),
          db.deliveryMessage.count({ where: { ...scope, deliveredAt: period } }),
          db.deliveryMessage.count({ where: { ...scope, readAt: period } }),
          db.deliveryMessage.count({
            where: { ...scope, status: "FAILED", updatedAt: period },
          }),
          db.deliveryMessage.count({
            where: { ...scope, status: { in: ["QUEUED", "SENDING"] } },
          }),
        ]);
      return { messagesSent, messagesDelivered, messagesRead, messagesFailed, messagesQueued };
    },

    // --------------------------------------------------------------
    // Audit (security/observability; idempotent webhook dedupe)
    // --------------------------------------------------------------

    /**
     * Idempotent audit write: `externalEventId` is unique per tenant, so an
     * at-least-once webhook delivery is recorded exactly once. Returns
     * `false` when the event was already processed.
     */
    async writeAuditLog(input: {
      organizationId: string;
      action: string;
      entityType: string;
      entityId?: string | null;
      externalEventId?: string | null;
      metadata?: Prisma.InputJsonValue;
    }): Promise<boolean> {
      try {
        await db.auditLog.create({
          data: {
            organizationId: assertOrganizationId(input.organizationId),
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId ?? null,
            externalEventId: input.externalEventId ?? null,
            metadata: input.metadata,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueConstraintError(error)) return false;
        throw error;
      }
    },

    async listAuditLogs(organizationId: string, limit = 20) {
      return db.auditLog.findMany({
        where: tenantWhere(organizationId),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
    },
  };
}

export type DeliveryRepository = ReturnType<typeof createDeliveryRepository>;

export const deliveryRepository = createDeliveryRepository(prisma);
