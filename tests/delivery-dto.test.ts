import { describe, expect, it, vi } from "vitest";
import type { DeliveryMessage } from "@prisma/client";
import {
  computeDeliveryKpis,
  toDeliveryAccountDTO,
  toDeliveryMessageDTO,
} from "@/modules/delivery/dashboard.service";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const BASE_DATE = new Date("2026-09-23T09:00:00.000Z");

function messageRow(overrides: Partial<DeliveryMessage> = {}): DeliveryMessage {
  return {
    id: "m1",
    organizationId: "org_1",
    executionId: "exec-1",
    channel: "WHATSAPP",
    recipientId: "+5511999",
    recipientName: "Ana",
    status: "DELIVERED",
    providerMessageId: "wamid-1",
    payload: {
      version: 1,
      executionId: "exec-1",
      campaignId: "camp-1",
      campaignName: "Lançamento",
      creatorId: "cr-1",
      creatorName: "Ana",
      message: { type: "text", text: "Bem-vinda ao lançamento!" },
    },
    sentAt: new Date("2026-09-23T10:00:00.000Z"),
    deliveredAt: new Date("2026-09-23T10:00:03.500Z"),
    readAt: null,
    attempts: 2,
    lastAttemptAt: new Date("2026-09-23T10:00:00.000Z"),
    nextAttemptAt: null,
    lastError: null,
    createdAt: BASE_DATE,
    updatedAt: BASE_DATE,
    ...overrides,
  } as DeliveryMessage;
}

describe("toDeliveryAccountDTO", () => {
  it("maps a safe account row with ISO dates", () => {
    const dto = toDeliveryAccountDTO({
      id: "a1",
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: "@brobond",
      status: "CONNECTED",
      expiresAt: new Date("2026-11-22T00:00:00.000Z"),
      createdAt: BASE_DATE,
    });
    expect(dto).toEqual({
      id: "a1",
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: "@brobond",
      status: "CONNECTED",
      expiresAt: "2026-11-22T00:00:00.000Z",
      createdAt: "2026-09-23T09:00:00.000Z",
    });
  });

  it("null expiry maps to null (never '')", () => {
    expect(
      toDeliveryAccountDTO({
        id: "a1",
        channel: "WHATSAPP",
        accountId: "p",
        accountName: null,
        status: "DISCONNECTED",
        expiresAt: null,
        createdAt: BASE_DATE,
      }).expiresAt,
    ).toBeNull();
  });

  it("the DTO type structurally forbids ciphertext fields", () => {
    const dto = toDeliveryAccountDTO({
      id: "a1",
      channel: "WHATSAPP",
      accountId: "p",
      accountName: null,
      status: "CONNECTED",
      expiresAt: null,
      createdAt: BASE_DATE,
    });
    expect(JSON.stringify(Object.keys(dto).sort())).toBe(
      JSON.stringify(
        ["accountId", "accountName", "channel", "createdAt", "expiresAt", "id", "status"].sort(),
      ),
    );
  });
});

describe("toDeliveryMessageDTO", () => {
  it("maps a full row with latency and preview", () => {
    const dto = toDeliveryMessageDTO(messageRow());
    expect(dto).toMatchObject({
      id: "m1",
      executionId: "exec-1",
      channel: "WHATSAPP",
      recipientId: "+5511999",
      recipientName: "Ana",
      status: "DELIVERED",
      providerMessageId: "wamid-1",
      campaignId: "camp-1",
      campaignName: "Lançamento",
      creatorName: "Ana",
      messageType: "text",
      messagePreview: "Bem-vinda ao lançamento!",
      attempts: 2,
      deliveryLatencyMs: 3_500,
      sentAt: "2026-09-23T10:00:00.000Z",
      deliveredAt: "2026-09-23T10:00:03.500Z",
      readAt: null,
    });
  });

  it("deliveryLatencyMs is null unless BOTH timestamps exist", () => {
    expect(toDeliveryMessageDTO(messageRow({ deliveredAt: null })).deliveryLatencyMs).toBeNull();
    expect(toDeliveryMessageDTO(messageRow({ sentAt: null })).deliveryLatencyMs).toBeNull();
  });

  it("latency is the exact millisecond delta", () => {
    const dto = toDeliveryMessageDTO(
      messageRow({
        sentAt: new Date("2026-09-23T10:00:00.000Z"),
        deliveredAt: new Date("2026-09-23T10:01:15.250Z"),
      }),
    );
    expect(dto.deliveryLatencyMs).toBe(75_250);
  });

  it("template payloads preview as 'Template: <name>'", () => {
    const dto = toDeliveryMessageDTO(
      messageRow({
        payload: { message: { type: "template", templateName: "order_ready", language: "pt_BR" } },
      }),
    );
    expect(dto.messageType).toBe("template");
    expect(dto.messagePreview).toBe("Template: order_ready");
  });

  it("text previews are truncated at 120 chars", () => {
    const dto = toDeliveryMessageDTO(
      messageRow({ payload: { message: { type: "text", text: "x".repeat(200) } } }),
    );
    expect(dto.messagePreview).toHaveLength(120);
  });

  it("malformed payloads map to safe nulls (never throw)", () => {
    const dto = toDeliveryMessageDTO(messageRow({ payload: null as never }));
    expect(dto).toMatchObject({
      campaignId: null,
      campaignName: null,
      creatorName: null,
      messageType: null,
      messagePreview: null,
    });
    const dto2 = toDeliveryMessageDTO(
      messageRow({ payload: { message: { type: "image" } } as never }),
    );
    expect(dto2.messageType).toBeNull();
    expect(dto2.messagePreview).toBeNull();
  });

  it("never includes the raw payload blob in the DTO", () => {
    const dto = toDeliveryMessageDTO(messageRow());
    expect(dto).not.toHaveProperty("payload");
    expect(dto).not.toHaveProperty("lastAttemptAt");
  });
});

describe("computeDeliveryKpis", () => {
  it("rolls up the contracted KPI definitions", () => {
    const kpis = computeDeliveryKpis({
      DRAFT: 2,
      QUEUED: 3,
      SENDING: 1,
      SENT: 5,
      DELIVERED: 7,
      READ: 4,
      FAILED: 2,
      CANCELLED: 1,
    });
    expect(kpis).toEqual({
      queued: 4, // QUEUED + SENDING (Fila)
      sent: 16, // SENT + DELIVERED + READ (Enviadas)
      delivered: 11, // DELIVERED + READ (Entregues)
      read: 4, // READ (Lidas)
      failed: 2, // FAILED (Falhas)
      cancelled: 1,
      draft: 2,
    });
  });

  it("missing statuses count as zero", () => {
    expect(computeDeliveryKpis({})).toEqual({
      queued: 0,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      cancelled: 0,
      draft: 0,
    });
    expect(computeDeliveryKpis({ READ: 3 })).toMatchObject({ read: 3, sent: 3, delivered: 3 });
  });

  it("READ messages count toward sent AND delivered (funnel semantics)", () => {
    const kpis = computeDeliveryKpis({ SENT: 1, DELIVERED: 1, READ: 1 });
    expect(kpis.sent).toBe(3);
    expect(kpis.delivered).toBe(2);
    expect(kpis.read).toBe(1);
  });
});
