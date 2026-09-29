import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { DeliveryStatusName } from "../core/delivery.interface";
import {
  createDeliveryRepository,
  type DeliveryDatabase,
  type DeliveryRepository,
} from "../repositories/delivery.repository";

/**
 * WhatsApp webhook handler (PR010 §5/§9) — official Cloud API webhook
 * surface (`object: "whatsapp_business_account"`).
 *
 * Handles the two contracted event families:
 *   - message_status   → `statuses[]` receipts (sent/delivered/read/failed)
 *   - message_received → inbound user `messages[]` (audited only)
 *
 * The tenant is resolved from `value.metadata.phone_number_id` — the
 * globally unique `DeliveryAccount.accountId`. Signature verification
 * happens in the ingress route BEFORE this handler ever runs; at-least-once
 * deliveries are deduplicated with the tenant-unique
 * `AuditLog.externalEventId` key.
 */

export interface WhatsAppStatusEvent {
  id?: string;
  status?: "sent" | "delivered" | "read" | "failed" | string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
}

export interface WhatsAppInboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

export interface WhatsAppChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number?: string; phone_number_id?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  statuses?: WhatsAppStatusEvent[];
  messages?: WhatsAppInboundMessage[];
}

export interface WhatsAppWebhookPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{ field?: string; value?: WhatsAppChangeValue }>;
  }>;
}

export interface WhatsAppWebhookSummary {
  tenantResolved: boolean;
  events: number;
  receiptsApplied: number;
  inboundMessages: number;
  duplicates: number;
}

export interface WhatsAppWebhookDependencies {
  db?: DeliveryDatabase;
  repository?: DeliveryRepository;
}

const STATUS_TARGETS: Record<string, DeliveryStatusName> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
};

function toDate(seconds: string | undefined, fallback: Date): Date {
  if (!seconds) return fallback;
  const millis = Number(seconds) * 1000;
  if (!Number.isFinite(millis)) return fallback;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function sanitizeFailure(event: WhatsAppStatusEvent): string {
  const first = event.errors?.[0];
  const detail = first?.message ?? first?.title;
  return detail
    ? `WhatsApp delivery failed: ${String(detail).slice(0, 180)}`
    : "WhatsApp delivery failed.";
}

export function createWhatsAppWebhookHandler(deps: WhatsAppWebhookDependencies = {}) {
  const db = deps.db ?? prisma;
  const repository: DeliveryRepository = deps.repository ?? createDeliveryRepository(db);

  return {
    /**
     * Process one signature-verified WhatsApp payload. Unknown tenants,
     * unknown messages and duplicate deliveries are absorbed idempotently —
     * the ingress route acknowledges with 200 to stop Meta retries.
     */
    async handle(rawPayload: string | WhatsAppWebhookPayload): Promise<WhatsAppWebhookSummary> {
      const payload: WhatsAppWebhookPayload =
        typeof rawPayload === "string"
          ? (JSON.parse(rawPayload) as WhatsAppWebhookPayload)
          : rawPayload;

      const summary: WhatsAppWebhookSummary = {
        tenantResolved: false,
        events: 0,
        receiptsApplied: 0,
        inboundMessages: 0,
        duplicates: 0,
      };
      if (payload.object !== "whatsapp_business_account") return summary;

      for (const entry of payload.entry ?? []) {
        for (const [changeIndex, change] of (entry.changes ?? []).entries()) {
          if (change.field !== "messages" || !change.value) continue;
          const phoneNumberId = change.value.metadata?.phone_number_id;
          if (!phoneNumberId) continue;
          const account = await repository.findAccountByProviderAccountId(phoneNumberId);
          if (!account) continue; // not our tenant — acknowledge and ignore
          summary.tenantResolved = true;
          const organizationId = account.organizationId;
          const value = change.value;

          // ---- message_status receipts -----------------------------------
          for (const statusEvent of value.statuses ?? []) {
            summary.events += 1;
            const providerMessageId = statusEvent.id;
            const status = statusEvent.status ?? "";
            const at = toDate(statusEvent.timestamp, new Date());
            if (!providerMessageId) continue;

            if (status === "failed") {
              const recorded = await repository.writeAuditLog({
                organizationId,
                action: "WHATSAPP_FAILED_RECEIPT",
                entityType: "DeliveryMessage",
                externalEventId: `whatsapp:${changeIndex}:${providerMessageId}:failed`,
                metadata: {
                  providerMessageId,
                  errors: (statusEvent.errors ?? []).slice(0, 3),
                } as Prisma.InputJsonValue,
              });
              if (!recorded) {
                summary.duplicates += 1;
                continue;
              }
              const { applied } = await repository.applyProviderFailure(organizationId, {
                providerMessageId,
                at,
                lastError: sanitizeFailure(statusEvent),
              });
              if (applied) summary.receiptsApplied += 1;
              continue;
            }

            const target = STATUS_TARGETS[status];
            if (!target) continue; // accepted/unknown statuses: ack only
            const recorded = await repository.writeAuditLog({
              organizationId,
              action: `WHATSAPP_${target}_RECEIPT`,
              entityType: "DeliveryMessage",
              externalEventId: `whatsapp:${changeIndex}:${providerMessageId}:${status}`,
              metadata: { providerMessageId, status } as Prisma.InputJsonValue,
            });
            if (!recorded) {
              summary.duplicates += 1;
              continue;
            }
            const { applied } = await repository.applyProviderReceipt(organizationId, {
              providerMessageId,
              target,
              at,
            });
            if (applied) summary.receiptsApplied += 1;
          }

          // ---- message_received (inbound) --------------------------------
          for (const inbound of value.messages ?? []) {
            summary.events += 1;
            const contact = value.contacts?.find((item) => item.wa_id === inbound.from);
            const recorded = await repository.writeAuditLog({
              organizationId,
              action: "WHATSAPP_MESSAGE_RECEIVED",
              entityType: "DeliveryMessage",
              externalEventId: `whatsapp:${changeIndex}:${inbound.id ?? "nomid"}:received`,
              metadata: {
                from: inbound.from ?? null,
                name: contact?.profile?.name ?? null,
                type: inbound.type ?? null,
                preview:
                  typeof inbound.text?.body === "string" ? inbound.text.body.slice(0, 80) : null,
              } as Prisma.InputJsonValue,
            });
            if (recorded) summary.inboundMessages += 1;
            else summary.duplicates += 1;
          }
        }
      }
      return summary;
    },
  };
}

export const whatsappWebhookHandler = createWhatsAppWebhookHandler();
