import "server-only";

import type { DeliveryMessage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import { decryptDeliverySecret } from "../core/crypto.service";
import {
  COMMERCE_EXECUTION_APPROVED,
  DeliveryError,
  DeliveryProviderError,
  DeliveryStateError,
  assertDeliveryTransition,
  type CommerceExecutionDeliveryRequest,
  type DeliveryChannelName,
  type DeliveryOutboundMessage,
  type DeliveryStatusName,
} from "../core/delivery.interface";
import { getDeliveryConnector } from "../core/delivery.factory";
import {
  createDeliveryRepository,
  deliveryRepository,
  type DeliveryDatabase,
  type DeliveryRepository,
} from "../repositories/delivery.repository";
import { decideRetry, sanitizeAttemptError } from "./retry.service";

/**
 * Delivery dispatcher (PR010 §7) — consumes an APPROVED `CommerceExecution`
 * and drives each message through the contracted lifecycle:
 *
 *   APPROVED ──enqueue──▶ QUEUED ──claim──▶ SENDING ──provider──▶ SENT
 *                                ▲    └─retryable failure──┘  │ (webhook)
 *                                └──────── backoff ───────────┘ ▼
 *                                                           DELIVERED ─▶ READ
 *
 * GUARANTEES
 *   - Idempotência: enqueue is anchored on the (tenant, executionId,
 *     channel, recipientId) unique key — re-dispatch of one execution never
 *     duplicates a provider send.
 *   - Optimistic claim: SENDING is acquired with a guarded updateMany, so
 *     two workers can never send the same row concurrently.
 *   - Retry: 3 attempts, exponential backoff, only for retryable failures
 *     (see `retry.service.ts`).
 *   - Tenant: every query is scoped to the execution's organization.
 */

export class DeliveryDispatchError extends DeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryDispatchError";
  }
}

const NO_ACCOUNT_ERROR = "No CONNECTED delivery account for this channel.";

/**
 * No CONNECTED account exists for the candidate's channel. Retryable by
 * design: an ADMIN may connect the account while the message still has
 * attempts left — the message must not die because of a temporary
 * infrastructure gap.
 */
export class DeliveryAccountUnavailableError extends DeliveryProviderError {
  constructor() {
    super(NO_ACCOUNT_ERROR, { status: 0, retryable: true });
    this.name = "DeliveryAccountUnavailableError";
  }
}

export interface DispatcherDependencies {
  db?: DeliveryDatabase;
  repository?: DeliveryRepository;
  now?: () => Date;
  /** Test seam — production always resolves via the factory Map. */
  resolveConnector?: typeof getDeliveryConnector;
}

export interface EnqueueResult {
  messageId: string;
  created: boolean;
  status: DeliveryStatusName;
}

export interface ProcessQueueResult {
  scanned: number;
  claimed: number;
  sent: number;
  retries: number;
  failed: number;
  skipped: number;
  /** Candidates deferred because no CONNECTED account exists for the channel. */
  missingAccounts: number;
}

function toOutboundMessage(payload: unknown): DeliveryOutboundMessage {
  const candidate = (payload ?? {}) as { message?: DeliveryOutboundMessage };
  if (candidate.message?.type === "text" && typeof candidate.message.text === "string") {
    return candidate.message;
  }
  if (
    candidate.message?.type === "template" &&
    typeof candidate.message.templateName === "string" &&
    typeof candidate.message.language === "string"
  ) {
    return candidate.message;
  }
  throw new DeliveryStateError("Delivery message payload does not contain a valid message body.");
}

export function createDeliveryDispatcher(deps: DispatcherDependencies = {}) {
  const db = deps.db ?? prisma;
  const repository: DeliveryRepository = deps.repository ?? createDeliveryRepository(db);
  const now = deps.now ?? (() => new Date());
  const resolveConnector = deps.resolveConnector ?? getDeliveryConnector;

  /**
   * Perform the provider send for one CLAIMED (SENDING) message: resolve
   * the active account, decrypt its token in memory, resolve the connector
   * through the factory and send. No retry logic lives here — failures
   * propagate to `processQueue`.
   */
  async function sendClaimedMessage(
    organizationId: string,
    candidate: DeliveryMessage,
  ): Promise<string> {
    const account = await repository.findActiveAccount(organizationId, candidate.channel);
    if (!account?.encryptedAccessToken) {
      throw new DeliveryAccountUnavailableError();
    }
    const accessToken = decryptDeliverySecret(account.encryptedAccessToken);
    const connector = resolveConnector(candidate.channel as DeliveryChannelName);
    const message = toOutboundMessage(candidate.payload);
    const sent = await connector.sendMessage({
      account: {
        accountId: account.accountId,
        accountName: account.accountName,
        accessToken,
      },
      recipientId: candidate.recipientId,
      message,
    });
    if (!sent.providerMessageId) {
      throw new DeliveryProviderError("Provider did not return a message id.", {
        status: 502,
        retryable: true,
      });
    }
    return sent.providerMessageId;
  }

  return {
    /**
     * Consume one CommerceExecution. ONLY `APPROVED` executions may enter
     * the queue (defense in depth on top of RBAC). Idempotent: replaying
     * the same execution returns the existing message (`created: false`).
     */
    async dispatchExecution(execution: CommerceExecutionDeliveryRequest): Promise<EnqueueResult> {
      const organizationId = assertOrganizationId(execution.organizationId);
      if (execution.status !== COMMERCE_EXECUTION_APPROVED) {
        throw new DeliveryDispatchError(
          `Only APPROVED CommerceExecutions may be dispatched (got "${execution.status}").`,
        );
      }
      if (!execution.executionId.trim()) {
        throw new DeliveryDispatchError("CommerceExecution id is required for idempotency.");
      }
      if (!execution.recipientId.trim()) {
        throw new DeliveryDispatchError("CommerceExecution recipient is required.");
      }

      const payload: Prisma.InputJsonValue = {
        version: 1,
        executionId: execution.executionId,
        campaignId: execution.campaignId ?? null,
        campaignName: execution.campaignName ?? null,
        creatorId: execution.creatorId ?? null,
        creatorName: execution.creatorName ?? null,
        message: execution.message as unknown as Prisma.InputJsonValue,
      };

      const { message, created } = await repository.enqueueMessage(organizationId, {
        executionId: execution.executionId,
        channel: execution.channel,
        recipientId: execution.recipientId,
        recipientName: execution.recipientName ?? execution.creatorName ?? null,
        payload,
        queuedAt: now(),
      });
      return { messageId: message.id, created, status: message.status as DeliveryStatusName };
    },

    /**
     * Drain the due queue slice for one tenant: QUEUED rows whose
     * `nextAttemptAt` has arrived, oldest first. Every candidate is claimed
     * individually so a concurrent worker simply skips it.
     */
    async processQueue(
      organizationId: string,
      options: { limit?: number; channel?: DeliveryChannelName } = {},
    ): Promise<ProcessQueueResult> {
      const scope = assertOrganizationId(organizationId);
      const current = now();
      const candidates = await repository.listDispatchCandidates(scope, {
        now: current,
        limit: options.limit ?? 25,
        channel: options.channel,
      });

      const result: ProcessQueueResult = {
        scanned: candidates.length,
        claimed: 0,
        sent: 0,
        retries: 0,
        failed: 0,
        skipped: 0,
        missingAccounts: 0,
      };

      for (const candidate of candidates) {
        // The attempt being consumed NOW (snapshot taken before the claim —
        // the candidate row may be mutated by the claim itself).
        const attemptsConsumed = candidate.attempts + 1;
        // Optimistic claim (QUEUED → SENDING, consumes one attempt).
        const claimed = await repository.claimMessageForSending(scope, candidate.id, current);
        if (!claimed) {
          result.skipped += 1;
          continue;
        }
        result.claimed += 1;

        try {
          const providerMessageId = await sendClaimedMessage(scope, candidate);
          await repository.markSent(scope, candidate.id, {
            providerMessageId,
            sentAt: now(),
          });
          result.sent += 1;
        } catch (error) {
          if (error instanceof DeliveryAccountUnavailableError) result.missingAccounts += 1;
          const decision = decideRetry({ error, attemptsConsumed, now: current });
          const lastError = sanitizeAttemptError(error);
          if (decision.action === "retry") {
            await repository.scheduleRetry(scope, candidate.id, {
              nextAttemptAt: decision.nextAttemptAt,
              lastError,
            });
            result.retries += 1;
          } else {
            await repository.markFailed(scope, candidate.id, { lastError });
            result.failed += 1;
          }
        }
      }
      return result;
    },

    /**
     * ADMIN "Reprocessar": FAILED/CANCELLED → QUEUED with a fresh attempt
     * budget. The legal transition is enforced against the live row.
     */
    async requeueMessage(
      organizationId: string,
      messageId: string,
    ): Promise<{ requeued: boolean }> {
      const scope = assertOrganizationId(organizationId);
      const message = await repository.findMessageById(scope, messageId);
      if (!message) return { requeued: false };
      assertDeliveryTransition(message.status as DeliveryStatusName, "QUEUED");
      const changed = await repository.requeueMessage(scope, messageId, now());
      if (changed > 0) {
        await repository.writeAuditLog({
          organizationId: scope,
          action: "DELIVERY_REQUEUED",
          entityType: "DeliveryMessage",
          entityId: messageId,
        });
      }
      return { requeued: changed > 0 };
    },

    /**
     * Cancel a not-yet-sent message (DRAFT/QUEUED/SENDING boundaries per
     * the transition map). A message already SENT is in provider-hand and
     * cannot be cancelled deterministically.
     */
    async cancelMessage(
      organizationId: string,
      messageId: string,
    ): Promise<{ cancelled: boolean }> {
      const scope = assertOrganizationId(organizationId);
      const message = await repository.findMessageById(scope, messageId);
      if (!message) return { cancelled: false };
      assertDeliveryTransition(message.status as DeliveryStatusName, "CANCELLED");
      const result = await db.deliveryMessage.updateMany({
        where: { id: messageId, organizationId: scope, status: message.status as never },
        data: { status: "CANCELLED", nextAttemptAt: null },
      });
      return { cancelled: result.count > 0 };
    },
  };
}

export type DeliveryDispatcher = ReturnType<typeof createDeliveryDispatcher>;

export const deliveryDispatcher = createDeliveryDispatcher({ repository: deliveryRepository });

/** Bound convenience exports (PR010 §7 contract surface). */
export const dispatchExecution = (execution: CommerceExecutionDeliveryRequest) =>
  deliveryDispatcher.dispatchExecution(execution);
export const processDeliveryQueue = (
  organizationId: string,
  options?: { limit?: number; channel?: DeliveryChannelName },
) => deliveryDispatcher.processQueue(organizationId, options);
export const requeueDeliveryMessage = (organizationId: string, messageId: string) =>
  deliveryDispatcher.requeueMessage(organizationId, messageId);
