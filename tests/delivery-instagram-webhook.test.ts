import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInstagramWebhookHandler } from "@/modules/delivery/instagram/webhook";
import type { DeliveryMessage } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function messageRow(overrides: Partial<DeliveryMessage> = {}): DeliveryMessage {
  return {
    id: "m1",
    organizationId: "org_1",
    executionId: "exec-1",
    channel: "INSTAGRAM",
    recipientId: "u1",
    recipientName: null,
    status: "SENT",
    providerMessageId: "mid-1",
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
  const updates: Array<Record<string, unknown>> = [];
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
        if (!message) return { applied: false, message: null };
        updates.push({ id: message.id, target: input.target, at: input.at });
        return { applied: true, message };
      },
    ),
  };
  return { repository, audit, updates };
}

const INSTAGRAM_ACCOUNT = {
  id: "acc-1",
  organizationId: "org_1",
  channel: "INSTAGRAM",
  accountId: "ig-business-1",
};

describe("Instagram webhook handler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores payloads of other objects", async () => {
    const { repository } = fakeRepository();
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({ object: "page", entry: [] });
    expect(summary).toMatchObject({ tenantResolved: false, events: 0 });
    expect(repository.findAccountByProviderAccountId).not.toHaveBeenCalled();
  });

  it("acknowledges unknown tenants without failing", async () => {
    const { repository } = fakeRepository({ accounts: [] });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [{ id: "ig-unknown", messaging: [{ delivery: { mids: ["a"] }, timestamp: 1 }] }],
    });
    expect(summary.tenantResolved).toBe(false);
    expect(summary.receiptsApplied).toBe(0);
  });

  it("applies message.delivered receipts to the provider mid", async () => {
    const { repository, updates } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1" })],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          time: 1_800_000_000,
          messaging: [
            { sender: { id: "u1" }, timestamp: 1_800_000_000_123, delivery: { mids: ["mid-1"] } },
          ],
        },
      ],
    });
    expect(summary.tenantResolved).toBe(true);
    expect(summary.receiptsApplied).toBe(1);
    expect(updates[0]).toMatchObject({ id: "m1", target: "DELIVERED" });
  });

  it("applies message.read receipts to every mid", async () => {
    const { repository, updates } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [
        messageRow({ id: "m1", providerMessageId: "mid-1" }),
        messageRow({ id: "m2", providerMessageId: "mid-2", status: "DELIVERED" }),
      ],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [{ timestamp: 1_800_000_000_123, read: { mids: ["mid-1", "mid-2"] } }],
        },
      ],
    });
    expect(summary.receiptsApplied).toBe(2);
    expect(updates.map((update) => update.target)).toEqual(["READ", "READ"]);
  });

  it("message.received (inbound DM) is audited with a preview, never answered", async () => {
    const { repository, audit } = fakeRepository({ accounts: [INSTAGRAM_ACCOUNT], messages: [] });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [
            {
              sender: { id: "user-9" },
              recipient: { id: "ig-business-1" },
              timestamp: 1_800_000_000_000,
              message: { mid: "in-1", text: "Quero comprar!" },
            },
          ],
        },
      ],
    });
    expect(summary.inboundMessages).toBe(1);
    const entry = audit.find((log) => log.action === "INSTAGRAM_MESSAGE_RECEIVED");
    expect(entry).toBeTruthy();
    expect(entry!.metadata).toMatchObject({
      senderId: "user-9",
      mid: "in-1",
      preview: "Quero comprar!",
    });
    // Inbound never touches outbound message rows:
    expect(repository.applyProviderReceipt).not.toHaveBeenCalled();
  });

  it("echo messages confirm SENT for app-originated sends", async () => {
    const { repository, updates } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1", status: "SENDING", sentAt: null })],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [
            {
              sender: { id: "ig-business-1" },
              recipient: { id: "u1" },
              timestamp: 1_800_000_000_000,
              message: { mid: "mid-1", is_echo: true, text: "Outbound!" },
            },
          ],
        },
      ],
    });
    expect(summary.receiptsApplied).toBe(1);
    expect(summary.inboundMessages).toBe(0);
    expect(updates[0]).toMatchObject({ target: "SENT" });
  });

  it("duplicate deliveries are deduplicated idempotently", async () => {
    const { repository } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1" })],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [{ timestamp: 1_800_000_000_000, delivery: { mids: ["mid-1"] } }],
        },
      ],
    };
    const first = await handler.handle(payload);
    const second = await handler.handle(payload);
    expect(first.receiptsApplied).toBe(1);
    expect(second.receiptsApplied).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("duplicate inbound messages are deduplicated", async () => {
    const { repository } = fakeRepository({ accounts: [INSTAGRAM_ACCOUNT] });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [{ timestamp: 1_800_000_000_000, message: { mid: "in-1", text: "oi" } }],
        },
      ],
    };
    await handler.handle(payload);
    const second = await handler.handle(payload);
    expect(second.inboundMessages).toBe(0);
    expect(second.duplicates).toBe(1);
  });

  it("handles entries without ids and events without mids gracefully", async () => {
    const { repository } = fakeRepository({ accounts: [INSTAGRAM_ACCOUNT] });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        { messaging: [{ timestamp: 1, delivery: { mids: ["x"] } }] },
        { id: "ig-business-1", messaging: [{ timestamp: 2, delivery: {} }] },
      ],
    });
    expect(summary.events).toBe(1);
    expect(summary.receiptsApplied).toBe(0);
  });

  it("parses a raw JSON string payload", async () => {
    const { repository, updates } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1" })],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle(
      JSON.stringify({
        object: "instagram",
        entry: [
          {
            id: "ig-business-1",
            messaging: [{ timestamp: 1_800_000_000, read: { mids: ["mid-1"] } }],
          },
        ],
      }),
    );
    expect(summary.receiptsApplied).toBe(1);
    expect(updates[0]!.target).toBe("READ");
  });

  it("uses the entry time fallback when event timestamp is seconds", async () => {
    const { repository } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1" })],
    });
    fakeRepository();
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    const summary = await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          time: 1_800_000_000,
          messaging: [{ delivery: { mids: ["mid-1"] } }],
        },
      ],
    });
    expect(summary.receiptsApplied).toBe(1);
  });

  it("audit entries are tenant-scoped and keyed", async () => {
    const { repository, audit } = fakeRepository({
      accounts: [INSTAGRAM_ACCOUNT],
      messages: [messageRow({ providerMessageId: "mid-1" })],
    });
    const handler = createInstagramWebhookHandler({ repository: repository as never });
    await handler.handle({
      object: "instagram",
      entry: [
        {
          id: "ig-business-1",
          messaging: [{ timestamp: 1_800_000_000_999, read: { mids: ["mid-1"] } }],
        },
      ],
    });
    const entry = audit[0]!;
    expect(entry.organizationId).toBe("org_1");
    expect(entry.action).toBe("INSTAGRAM_READ_RECEIPT");
    expect(String(entry.externalEventId)).toContain("instagram:");
    expect(String(entry.externalEventId)).toContain("mid-1");
  });
});
