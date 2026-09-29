import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { createTikTokWebhookHandler } from "@/modules/connectors/tiktok/webhooks/handler";

function webhookDb() {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    tikTokAccount: {
      findFirst: vi.fn(async ({ where }: { where: { shopId: string } }) =>
        where.shopId === "shop-known" ? { organizationId: "org-1" } : null,
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (events.some((event) => event.externalEventId === data.externalEventId)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        events.push(data);
        return data;
      }),
    },
  };
}

describe("TikTok webhook handler", () => {
  it("records requested event names in a tenant-scoped AuditLog", async () => {
    const db = webhookDb();
    const handler = createTikTokWebhookHandler(db as never);
    await expect(
      handler.handle(
        JSON.stringify({
          tts_notification_id: "evt-1",
          shop_id: "shop-known",
          event_type: "product.updated",
          data: { product_id: "product-1" },
        }),
      ),
    ).resolves.toEqual({ accepted: true, duplicate: false });
    expect(db.events[0]).toMatchObject({
      organizationId: "org-1",
      action: "TIKTOK_WEBHOOK_PRODUCT_UPDATED",
      entityType: "product",
      entityId: "product-1",
      externalEventId: "evt-1",
    });
  });

  it("is idempotent for at-least-once deliveries", async () => {
    const db = webhookDb();
    const handler = createTikTokWebhookHandler(db as never);
    const body = JSON.stringify({
      notification_id: "evt-2",
      shop_id: "shop-known",
      event_type: "order.created",
      data: { order_id: "order-1" },
    });
    await handler.handle(body);
    await expect(handler.handle(body)).resolves.toEqual({ accepted: true, duplicate: true });
    expect(db.events).toHaveLength(1);
  });

  it("acknowledges a signed-but-unmapped shop without assigning it to a tenant", async () => {
    const db = webhookDb();
    const handler = createTikTokWebhookHandler(db as never);
    await expect(
      handler.handle(
        JSON.stringify({
          notification_id: "evt-3",
          shop_id: "unknown",
          event_type: "creator.updated",
        }),
      ),
    ).resolves.toEqual({ accepted: true, duplicate: false });
    expect(db.events).toHaveLength(0);
  });
});
