import "server-only";

/**
 * PR010 §6 — Instagram Business Messaging webhook handler.
 *
 * Consumes SIGNATURE-VERIFIED payloads (`core/webhook-security.ts` runs
 * before this module ever sees a body) and applies:
 *
 *   - `messaging[].delivery.mids` → DELIVERED receipts ("message.delivered")
 *   - `messaging[].read.mids`     → READ receipts ("message.read")
 *   - `messaging[].message` (is_echo) → SENT confirmation for our sends
 *   - `messaging[].message` (inbound) → "message.received" — audited with a
 *     text preview, never auto-answered, never touches outbound rows.
 *
 * Tenant resolution is token-free: `entry[].id` is the Instagram Business
 * Account id, globally unique in `DeliveryAccount.accountId`, so a payload
 * resolves at most one tenant. Unknown payloads/tenants are acked (200) —
 * Meta retries only on 5xx, and noise is not an error.
 *
 * Idempotency: every event writes `AuditLog` keyed by
 * `(organizationId, externalEventId)`; an at-least-once Meta redelivery is
 * recorded exactly once and counted as a duplicate.
 */

import { prisma } from "@/lib/prisma";
import { createDeliveryRepository } from "@/modules/delivery/repositories/delivery.repository";
import type { DeliveryStatusName } from "@/modules/delivery/core/delivery.interface";

export const INSTAGRAM_AUDIT_EVENTS = {
  DELIVERY_RECEIPT: "INSTAGRAM_DELIVERY_RECEIPT",
  READ_RECEIPT: "INSTAGRAM_READ_RECEIPT",
  SENT_CONFIRMATION: "INSTAGRAM_SENT_CONFIRMATION",
  MESSAGE_RECEIVED: "INSTAGRAM_MESSAGE_RECEIVED",
} as const;

/** Structural subset of `DeliveryRepository` used by the handler. */
export interface InstagramWebhookRepository {
  findAccountByProviderAccountId(accountId: string): Promise<{ organizationId: string } | null>;
  applyProviderReceipt(
    organizationId: string,
    input: { providerMessageId: string; target: DeliveryStatusName; at: Date },
  ): Promise<{ applied: boolean; message: { id: string } | null }>;
  writeAuditLog(input: {
    organizationId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    externalEventId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<boolean>;
}

export interface InstagramWebhookSummary {
  /** true when at least one entry resolved to a connected tenant account. */
  tenantResolved: boolean;
  /** messaging events processed for resolved tenants. */
  events: number;
  /** forward-progress receipts applied (SENT/DELIVERED/READ). */
  receiptsApplied: number;
  /** inbound "message.received" audited. */
  inboundMessages: number;
  /** at-least-once duplicates skipped by the audit idempotency key. */
  duplicates: number;
}

interface InstagramMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; is_echo?: boolean; text?: string };
  delivery?: { mids?: string[]; watermark?: number };
  read?: { mids?: string[]; watermark?: number };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Meta sends seconds in `entry.time` but milliseconds in `messaging[].timestamp`. */
function eventDate(eventMsOrS: unknown, entryTimeS: unknown, fallback: Date): Date {
  if (typeof eventMsOrS === "number" && Number.isFinite(eventMsOrS) && eventMsOrS > 0) {
    return new Date(eventMsOrS < 1e12 ? eventMsOrS * 1000 : eventMsOrS);
  }
  if (typeof entryTimeS === "number" && Number.isFinite(entryTimeS) && entryTimeS > 0) {
    return new Date(entryTimeS * 1000);
  }
  return fallback;
}

function preview(text: unknown): string {
  return typeof text === "string" ? text.slice(0, 120) : "";
}

export interface InstagramWebhookDeps {
  repository?: InstagramWebhookRepository;
  now?: () => Date;
}

export function createInstagramWebhookHandler(deps: InstagramWebhookDeps = {}) {
  const repository =
    deps.repository ?? (createDeliveryRepository(prisma) as unknown as InstagramWebhookRepository);
  const now = deps.now ?? (() => new Date());

  async function handle(payload: unknown): Promise<InstagramWebhookSummary> {
    const summary: InstagramWebhookSummary = {
      tenantResolved: false,
      events: 0,
      receiptsApplied: 0,
      inboundMessages: 0,
      duplicates: 0,
    };

    let body: Record<string, unknown> | null = null;
    if (typeof payload === "string") {
      try {
        body = asRecord(JSON.parse(payload));
      } catch {
        return { ...summary, tenantResolved: false };
      }
    } else {
      body = asRecord(payload);
    }
    if (!body || body.object !== "instagram") return summary;

    const entries = Array.isArray(body.entry) ? body.entry : [];
    for (const rawEntry of entries) {
      const entry = asRecord(rawEntry);
      const entryId = entry ? asString(entry.id) : null;
      if (!entry || !entryId) continue; // entry without an id cannot resolve a tenant
      const account = await repository.findAccountByProviderAccountId(entryId);
      if (!account) continue; // unknown tenant — ack-only, never an error
      summary.tenantResolved = true;
      const organizationId = account.organizationId;
      const entryTime = entry.time;
      const messaging = Array.isArray(entry.messaging)
        ? (entry.messaging as InstagramMessagingEvent[])
        : [];

      for (const event of messaging) {
        summary.events += 1;
        const at = eventDate(event.timestamp, entryTime, now());

        // — message.delivered / message.read receipts ---------------------
        const receipts: Array<{
          kind: string;
          mids: string[];
          target: DeliveryStatusName;
          action: string;
        }> = [
          {
            kind: "delivered",
            mids: event.delivery?.mids ?? [],
            target: "DELIVERED",
            action: INSTAGRAM_AUDIT_EVENTS.DELIVERY_RECEIPT,
          },
          {
            kind: "read",
            mids: event.read?.mids ?? [],
            target: "READ",
            action: INSTAGRAM_AUDIT_EVENTS.READ_RECEIPT,
          },
        ];
        for (const receipt of receipts) {
          for (const mid of receipt.mids) {
            if (!mid) continue;
            // The audit idempotency key is written FIRST: a redelivery is a
            // duplicate before it can re-apply anything.
            const recorded = await repository.writeAuditLog({
              organizationId,
              action: receipt.action,
              entityType: "DeliveryMessage",
              entityId: mid,
              externalEventId: `instagram:${entryId}:${receipt.kind}:${mid}`,
              metadata: {
                channel: "INSTAGRAM",
                accountId: entryId,
                providerMessageId: mid,
                receiptAt: at.toISOString(),
              },
            });
            if (!recorded) {
              summary.duplicates += 1;
              continue;
            }
            const { applied } = await repository.applyProviderReceipt(organizationId, {
              providerMessageId: mid,
              target: receipt.target,
              at,
            });
            if (applied) summary.receiptsApplied += 1;
          }
        }

        if (!event.message) continue;

        // — Echo → SENT confirmation for app-originated sends --------------
        if (event.message.is_echo) {
          const mid = asString(event.message.mid);
          if (!mid) continue;
          const recorded = await repository.writeAuditLog({
            organizationId,
            action: INSTAGRAM_AUDIT_EVENTS.SENT_CONFIRMATION,
            entityType: "DeliveryMessage",
            entityId: mid,
            externalEventId: `instagram:${entryId}:echo:${mid}`,
            metadata: {
              channel: "INSTAGRAM",
              accountId: entryId,
              providerMessageId: mid,
              sentAt: at.toISOString(),
            },
          });
          if (!recorded) {
            summary.duplicates += 1;
            continue;
          }
          const { applied } = await repository.applyProviderReceipt(organizationId, {
            providerMessageId: mid,
            target: "SENT",
            at,
          });
          if (applied) summary.receiptsApplied += 1;
          continue;
        }

        // — message.received (inbound DM): audit-only, never answered ------
        summary.inboundMessages += 1;
        const senderId = asString(event.sender?.id);
        const mid = asString(event.message.mid);
        const recorded = await repository.writeAuditLog({
          organizationId,
          action: INSTAGRAM_AUDIT_EVENTS.MESSAGE_RECEIVED,
          entityType: "DeliveryAccount",
          entityId: senderId,
          externalEventId: `instagram:${entryId}:inbound:${mid ?? `${senderId ?? "unknown"}:${at.getTime()}`}`,
          metadata: {
            channel: "INSTAGRAM",
            senderId,
            recipientId: asString(event.recipient?.id),
            mid,
            preview: preview(event.message.text),
            receivedAt: at.toISOString(),
          },
        });
        if (!recorded) {
          summary.inboundMessages -= 1; // a redelivery of the same inbound
          summary.duplicates += 1;
        }
      }
    }
    return summary;
  }

  return { handle };
}

export const instagramWebhookHandler = createInstagramWebhookHandler();

export type { InstagramWebhookRepository as InstagramWebhookRepositoryShape };
