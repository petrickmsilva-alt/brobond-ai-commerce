import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWhatsAppWebhookHandler } from "@/modules/delivery/whatsapp/webhook";
import type { DeliveryMessage } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function messageRow(overrides: Partial<DeliveryMessage> = {}): DeliveryMessage {
  return {
    id: "m1",
    organizationId: "org_1",
    executionId: "exec-1",
    channel: "WHATSAPP",
    recipientId: "+5511999",
    recipientName: null,
    status: "SENT",
    providerMessageId: "wamid-1",
    payload: {},
    sentAt: new Date("2026-09-23T10:00:00Z"),
    deliveredAt: null,
    readAt: null,
    attempts: 1,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
    createdAt: new Date("2026-09-23T09:59:00Z"),
    updatedAt: new Date("2026-09-23T10:00:00Z"),
    ...overrides,
  } as DeliveryMessage;
}

function fakeRepository(
  options: { accounts?: Record<string, unknown>[]; messages?: DeliveryMessage[] } = {},
) {
  const audit: Array<Record<string, unknown>> = [];
  const receipts: Array<Record<string, unknown>> = [];
  const failures: Array<Record<string, unknown>> = [];
  const repository = {
    findAccountByProviderAccountId: vi.fn(async (accountId: string) => {
      return options.accounts?.find((account) => account.accountId === accountId) ?? null;
    }),
    writeAuditLog: vi.fn(async (input: Record<string, unknown>) => {
      const duplicate = audit.some(
        (entry) =>
          entry.organizationId === input.organizationId &&
          entry.externalEventId === input.externalEventId,
      );
      if (duplicate) return false;
      audit.push(input);
      return true;
    }),
    applyProviderReceipt: vi.fn(
      async (org: string, input: { providerMessageId: string; target: string; at: Date }) => {
        const message = options.messages?.find(
          (candidate) =>
            candidate.organizationId === org &&
            candidate.providerMessageId === input.providerMessageId,
        );
        receipts.push({ org, ...input });
        if (!message) return { applied: false, message: null };
        return { applied: true, message };
      },
    ),
    applyProviderFailure: vi.fn(
      async (org: string, input: { providerMessageId: string; at: Date; lastError: string }) => {
        const message = options.messages?.find(
          (candidate) =>
            candidate.organizationId === org &&
            candidate.providerMessageId === input.providerMessageId,
        );
        failures.push({ org, ...input });
        if (!message) return { applied: false, message: null };
        return { applied: true, message };
      },
    ),
  };
  return { repository, audit, receipts, failures };
}

const WA_ACCOUNT = {
  id: "acc-1",
  organizationId: "org_1",
  channel: "WHATSAPP",
  accountId: "pnid-1",
};

function waPayload(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { phone_number_id: "pnid-1" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

describe("WhatsApp webhook handler — message_status", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores foreign objects", async () => {
    const { repository } = fakeRepository();
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({ object: "instagram", entry: [] });
    expect(summary.events).toBe(0);
    expect(repository.findAccountByProviderAccountId).not.toHaveBeenCalled();
  });

  it("maps 'delivered' statuses onto the message", async () => {
    const { repository, receipts } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({
        statuses: [
          { id: "wamid-1", status: "delivered", timestamp: "1800000100", recipient_id: "5511999" },
        ],
      }),
    );
    expect(summary.tenantResolved).toBe(true);
    expect(summary.receiptsApplied).toBe(1);
    expect(receipts[0]).toMatchObject({
      org: "org_1",
      providerMessageId: "wamid-1",
      target: "DELIVERED",
    });
    expect((receipts[0]!.at as Date).toISOString()).toBe("2027-01-15T08:01:40.000Z");
  });

  it("maps 'read' statuses onto the message", async () => {
    const { repository, receipts } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1", status: "DELIVERED" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "read", timestamp: "1800000200" }] }),
    );
    expect(summary.receiptsApplied).toBe(1);
    expect(receipts[0]!.target).toBe("READ");
  });

  it("maps 'sent' statuses onto the message", async () => {
    const { repository, receipts } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1", status: "SENDING", sentAt: null })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "sent", timestamp: "1800000000" }] }),
    );
    expect(receipts[0]!.target).toBe("SENT");
  });

  it("maps 'failed' statuses through applyProviderFailure with a sanitized reason", async () => {
    const { repository, failures } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({
        statuses: [
          {
            id: "wamid-1",
            status: "failed",
            timestamp: "1800000300",
            errors: [
              {
                code: 131_047,
                title: "Re-engagement",
                message: "Message failed to send outside window",
              },
            ],
          },
        ],
      }),
    );
    expect(summary.receiptsApplied).toBe(1);
    expect(failures[0]!.lastError).toContain("outside window");
    expect(String(failures[0]!.lastError).length).toBeLessThanOrEqual(200);
  });

  it("failed receipts without a detail get a generic, safe reason", async () => {
    const { repository, failures } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "failed", timestamp: "1800000300" }] }),
    );
    expect(failures[0]!.lastError).toBe("WhatsApp delivery failed.");
  });

  it("acknowledges unknown statuses without touching messages", async () => {
    const { repository, receipts, failures } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "accepted", timestamp: "1800000000" }] }),
    );
    expect(summary.events).toBe(1);
    expect(summary.receiptsApplied).toBe(0);
    expect(receipts).toHaveLength(0);
    expect(failures).toHaveLength(0);
  });

  it("acknowledges unknown tenants and unknown phone numbers", async () => {
    const { repository } = fakeRepository({ accounts: [] });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(waPayload({ statuses: [{ id: "w", status: "read" }] }));
    expect(summary.tenantResolved).toBe(false);
  });

  it("duplicate status webhooks are deduplicated idempotently", async () => {
    const { repository } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const payload = waPayload({
      statuses: [{ id: "wamid-1", status: "delivered", timestamp: "1800000100" }],
    });
    const first = await handler.handle(payload);
    const second = await handler.handle(payload);
    expect(first.receiptsApplied).toBe(1);
    expect(second.receiptsApplied).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("duplicate failed receipts are deduplicated", async () => {
    const { repository } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const payload = waPayload({
      statuses: [
        { id: "wamid-1", status: "failed", timestamp: "1800000100", errors: [{ message: "x" }] },
      ],
    });
    await handler.handle(payload);
    const second = await handler.handle(payload);
    expect(second.receiptsApplied).toBe(0);
    expect(second.duplicates).toBe(1);
  });
});

describe("WhatsApp webhook handler — message_received", () => {
  it("audits inbound messages with contact name and preview", async () => {
    const { repository, audit } = fakeRepository({ accounts: [WA_ACCOUNT] });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({
        contacts: [{ wa_id: "5511888", profile: { name: "Maria" } }],
        messages: [
          {
            id: "wamid-in-1",
            from: "5511888",
            timestamp: "1800000000",
            type: "text",
            text: { body: "Tem estoque?" },
          },
        ],
      }),
    );
    expect(summary.inboundMessages).toBe(1);
    const entry = audit.find((log) => log.action === "WHATSAPP_MESSAGE_RECEIVED");
    expect(entry).toBeTruthy();
    expect(entry!.metadata).toMatchObject({
      from: "5511888",
      name: "Maria",
      preview: "Tem estoque?",
    });
  });

  it("handles inbound messages without contacts or text", async () => {
    const { repository, audit } = fakeRepository({ accounts: [WA_ACCOUNT] });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      waPayload({
        messages: [{ id: "wamid-in-2", from: "5511777", timestamp: "1800000000", type: "image" }],
      }),
    );
    expect(summary.inboundMessages).toBe(1);
    expect(audit[0]!.metadata).toMatchObject({ name: null, preview: null, type: "image" });
  });

  it("deduplicates repeated inbound deliveries", async () => {
    const { repository } = fakeRepository({ accounts: [WA_ACCOUNT] });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const payload = waPayload({
      messages: [
        {
          id: "wamid-in-1",
          from: "1",
          timestamp: "1800000000",
          type: "text",
          text: { body: "oi" },
        },
      ],
    });
    await handler.handle(payload);
    const second = await handler.handle(payload);
    expect(second.inboundMessages).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("skips changes that are not the messages field", async () => {
    const { repository } = fakeRepository({ accounts: [WA_ACCOUNT] });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "whatsapp_business_account",
      entry: [{ id: "waba-1", changes: [{ field: "account_update", value: {} }] }],
    });
    expect(summary.tenantResolved).toBe(false);
    expect(summary.events).toBe(0);
  });

  it("parses raw JSON string payloads", async () => {
    const { repository, receipts } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    await handler.handle(
      JSON.stringify(
        waPayload({ statuses: [{ id: "wamid-1", status: "read", timestamp: "1800000999" }] }),
      ),
    );
    expect(receipts[0]!.target).toBe("READ");
  });

  it("status receipt audit entries carry the tenant, action and key", async () => {
    const { repository, audit } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "delivered", timestamp: "1800000100" }] }),
    );
    const entry = audit[0]!;
    expect(entry.organizationId).toBe("org_1");
    expect(entry.action).toBe("WHATSAPP_DELIVERED_RECEIPT");
    expect(String(entry.externalEventId)).toContain("whatsapp:");
    expect(String(entry.externalEventId)).toContain("wamid-1");
  });

  it("malformed timestamps fall back safely", async () => {
    const { repository, receipts } = fakeRepository({
      accounts: [WA_ACCOUNT],
      messages: [messageRow({ providerMessageId: "wamid-1" })],
    });
    const handler = createWhatsAppWebhookHandler({ repository: repository as never });
    await handler.handle(
      waPayload({ statuses: [{ id: "wamid-1", status: "read", timestamp: "not-a-number" }] }),
    );
    expect(receipts[0]!.at).toBeInstanceOf(Date);
    expect(Number.isNaN((receipts[0]!.at as Date).getTime())).toBe(false);
  });
});
