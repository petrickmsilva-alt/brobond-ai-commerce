import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tiktokWebhookPayloadSchema } from "../validators";

export type TikTokWebhookDatabase = Pick<PrismaClient, "tikTokAccount" | "auditLog">;

export type TikTokWebhookEvent =
  "product.updated" | "order.created" | "creator.updated" | "unknown";

function normalizeEvent(payload: {
  type?: string | number;
  event_type?: string;
}): TikTokWebhookEvent {
  const candidate = String(payload.event_type ?? payload.type ?? "")
    .trim()
    .toLowerCase();
  // Accepts the application event names as well as TikTok Shop's documented
  // category names, which vary by API version/Partner Center subscription.
  if (
    candidate === "product.updated" ||
    candidate === "product_status_change" ||
    candidate === "product_update"
  ) {
    return "product.updated";
  }
  if (
    candidate === "order.created" ||
    candidate === "order_status_change" ||
    candidate === "order_create"
  ) {
    return "order.created";
  }
  if (candidate === "creator.updated" || candidate === "creator_update") return "creator.updated";
  return "unknown";
}

function stringId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function eventEntityId(
  event: TikTokWebhookEvent,
  data: Record<string, unknown> | undefined,
): string | undefined {
  if (!data) return undefined;
  if (event === "product.updated") return stringId(data.product_id ?? data.id);
  if (event === "order.created") return stringId(data.order_id ?? data.id);
  if (event === "creator.updated") return stringId(data.creator_id ?? data.id ?? data.open_id);
  return undefined;
}

/** Safe, bounded metadata: no customer addresses, tokens or arbitrary raw body. */
function auditMetadata(input: {
  event: TikTokWebhookEvent;
  notificationId: string;
  shopId: string;
  entityId?: string;
}): Prisma.InputJsonValue {
  return {
    provider: "tiktok-shop",
    event: input.event,
    notificationId: input.notificationId,
    shopId: input.shopId,
    entityId: input.entityId ?? null,
  };
}

export function createTikTokWebhookHandler(db: TikTokWebhookDatabase = prisma) {
  return {
    async handle(rawBody: string): Promise<{ accepted: boolean; duplicate: boolean }> {
      let unknown: unknown;
      try {
        unknown = JSON.parse(rawBody);
      } catch {
        throw new Error("TikTok webhook body is not valid JSON.");
      }
      const parsed = tiktokWebhookPayloadSchema.safeParse(unknown);
      if (!parsed.success) throw new Error("TikTok webhook payload is invalid.");
      const payload = parsed.data;
      const shopId = stringId(payload.shop_id);
      const notificationId = payload.tts_notification_id ?? payload.notification_id;
      if (!shopId || !notificationId) {
        throw new Error("TikTok webhook is missing shop_id or notification id.");
      }

      // Signature validation proves TikTok sent it. This mapping establishes
      // the tenant boundary — no organization id is trusted from the payload.
      const account = await db.tikTokAccount.findFirst({
        where: { shopId, status: "CONNECTED" },
        select: { organizationId: true },
      });
      if (!account) {
        // A valid but unknown shop is acknowledged to avoid retry storms; no
        // customer data is persisted and no tenant can be guessed.
        return { accepted: true, duplicate: false };
      }

      const event = normalizeEvent(payload);
      const data = payload.data as Record<string, unknown> | undefined;
      const entityId = eventEntityId(event, data);
      try {
        await db.auditLog.create({
          data: {
            organizationId: account.organizationId,
            action: `TIKTOK_WEBHOOK_${event.toUpperCase().replace(".", "_")}`,
            entityType: event === "unknown" ? "TikTokWebhook" : event.split(".")[0]!,
            entityId,
            externalEventId: notificationId,
            metadata: auditMetadata({ event, notificationId, shopId, entityId }),
          },
        });
      } catch (error) {
        // Prisma P2002 is an expected at-least-once delivery duplicate.
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: string }).code === "P2002"
        ) {
          return { accepted: true, duplicate: true };
        }
        throw error;
      }

      // Processing is deliberately decoupled from acknowledgement. A webhook
      // records an auditable, idempotent change signal; the next manual/scheduled
      // importer run reconciles authoritative Product/Order/Creator data via API.
      return { accepted: true, duplicate: false };
    },
  };
}

export const tiktokWebhookHandler = createTikTokWebhookHandler();
