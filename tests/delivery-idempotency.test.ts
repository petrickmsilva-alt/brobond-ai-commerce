import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryMessage } from "@prisma/client";
import { createDeliveryDispatcher } from "@/modules/delivery/queue/dispatcher";
import { encryptDeliverySecret } from "@/modules/delivery/core/crypto.service";
import type { DeliveryConnector } from "@/modules/delivery/core/delivery.interface";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

/**
 * Idempotência obrigatória (PR010 §7) — exercised end-to-end across the
 * three idempotency anchors of the engine:
 *   1. enqueue   — (tenant, executionId, channel, recipientId) unique key
 *   2. claim     — optimistic QUEUED → SENDING guard (at-least-once workers)
 *   3. receipts  — forward-only lifecycle + tenant-unique audit keys
 */
const KEY = Buffer.alloc(32, 17).toString("base64url");
const NOW = new Date("2026-09-23T12:00:00.000Z");

function world() {
  const messages: DeliveryMessage[] = [];
  const audit: Array<{ organizationId: string; externalEventId: string | null }> = [];
  let sends = 0;
  const account = {
    id: "acc-1",
    organizationId: "org_1",
    channel: "WHATSAPP",
    accountId: "pnid-1",
    accountName: "Brobond",
    encryptedAccessToken: encryptDeliverySecret("token", KEY),
    status: "CONNECTED",
  };
  const repository = {
    enqueueMessage: vi.fn(async (org: string, input: Record<string, string>) => {
      const existing = messages.find(
        (message) =>
          message.organizationId === org &&
          message.executionId === input.executionId &&
          message.channel === (input.channel as string) &&
          message.recipientId === input.recipientId,
      );
      if (existing) return { message: existing, created: false };
      const message = {
        id: `m${messages.length + 1}`,
        organizationId: org,
        executionId: input.executionId,
        channel: input.channel,
        recipientId: input.recipientId,
        recipientName: input.recipientName ?? null,
        status: "QUEUED",
        providerMessageId: null,
        payload: input.payload,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        attempts: 0,
        lastAttemptAt: null,
        nextAttemptAt: NOW,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as unknown as DeliveryMessage;
      messages.push(message);
      return { message, created: true };
    }),
    listDispatchCandidates: vi.fn(async (org: string) =>
      messages.filter((message) => message.organizationId === org && message.status === "QUEUED"),
    ),
    claimMessageForSending: vi.fn(async (_org: string, id: string, _now: Date) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || message.status !== "QUEUED") return false;
      message.status = "SENDING";
      message.attempts += 1;
      return true;
    }),
    findActiveAccount: vi.fn(async () => account),
    markSent: vi.fn(
      async (_o: string, id: string, input: { providerMessageId: string; sentAt: Date }) => {
        const message = messages.find((candidate) => candidate.id === id);
        if (!message || message.status !== "SENDING") return 0;
        message.status = "SENT";
        message.providerMessageId = input.providerMessageId;
        message.sentAt = input.sentAt;
        return 1;
      },
    ),
    scheduleRetry: vi.fn(
      async (_o: string, id: string, input: { nextAttemptAt: Date; lastError: string }) => {
        const message = messages.find((candidate) => candidate.id === id);
        if (!message || message.status !== "SENDING") return 0;
        message.status = "QUEUED";
        message.nextAttemptAt = input.nextAttemptAt;
        message.lastError = input.lastError;
        return 1;
      },
    ),
    markFailed: vi.fn(async (_o: string, id: string, input: { lastError: string }) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || message.status !== "SENDING") return 0;
      message.status = "FAILED";
      message.lastError = input.lastError;
      return 1;
    }),
    findMessageById: vi.fn(async (org: string, id: string) => {
      return messages.find((m) => m.id === id && m.organizationId === org) ?? null;
    }),
    findByProviderMessageId: vi.fn(async (org: string, mid: string) => {
      return messages.find((m) => m.organizationId === org && m.providerMessageId === mid) ?? null;
    }),
    requeueMessage: vi.fn(async (_o: string, id: string, now: Date) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || !["FAILED", "CANCELLED"].includes(message.status)) return 0;
      message.status = "QUEUED";
      message.attempts = 0;
      message.nextAttemptAt = now;
      return 1;
    }),
    applyProviderReceipt: vi.fn(
      async (org: string, input: { providerMessageId: string; target: string; at: Date }) => {
        const message = messages.find(
          (candidate) =>
            candidate.organizationId === org &&
            candidate.providerMessageId === input.providerMessageId,
        );
        if (!message) return { applied: false, message: null };
        const rank: Record<string, number> = {
          DRAFT: 0,
          QUEUED: 1,
          SENDING: 2,
          SENT: 3,
          DELIVERED: 4,
          READ: 5,
        };
        const current = rank[message.status] ?? -1;
        const next = rank[input.target] ?? -1;
        if (next <= current) return { applied: false, message };
        message.status = input.target as DeliveryMessage["status"];
        if (input.target === "SENT") message.sentAt = input.at;
        if (input.target === "DELIVERED") message.deliveredAt = input.at;
        if (input.target === "READ") message.readAt = input.at;
        return { applied: true, message };
      },
    ),
    writeAuditLog: vi.fn(
      async (input: { organizationId: string; externalEventId?: string | null }) => {
        const duplicate = audit.some(
          (entry) =>
            entry.organizationId === input.organizationId &&
            entry.externalEventId === (input.externalEventId ?? null),
        );
        if (duplicate) return false;
        audit.push({
          organizationId: input.organizationId,
          externalEventId: input.externalEventId ?? null,
        });
        return true;
      },
    ),
  };
  const connector: DeliveryConnector & { sendMessage: ReturnType<typeof vi.fn> } = {
    channel: "WHATSAPP",
    sendMessage: vi.fn(async () => {
      sends += 1;
      // Provider MUST see exactly one logical message per (execution, recipient):
      return { providerMessageId: `wamid-${sends}` };
    }),
  };
  const dispatcher = createDeliveryDispatcher({
    repository: repository as never,
    now: () => NOW,
    resolveConnector: () => connector,
  });
  return {
    messages,
    audit,
    repository,
    connector,
    dispatcher,
    account,
    get sends() {
      return sends;
    },
  };
}

const EXECUTION = {
  organizationId: "org_1",
  executionId: "exec-42",
  status: "APPROVED",
  channel: "WHATSAPP" as const,
  recipientId: "+5511999",
  recipientName: "Ana",
  campaignId: "camp-1",
  campaignName: "Lançamento",
  message: { type: "text" as const, text: "Bem-vinda!" },
};

describe("End-to-end idempotency", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("re-dispatching the same execution produces ONE message and ONE provider send", async () => {
    const w = world();
    // The approval pipeline replays the execution three times (at-least-once).
    await w.dispatcher.dispatchExecution(EXECUTION);
    await w.dispatcher.dispatchExecution(EXECUTION);
    await w.dispatcher.dispatchExecution(EXECUTION);
    expect(w.messages).toHaveLength(1);

    await w.dispatcher.processQueue("org_1");
    expect(w.sends).toBe(1);
    expect(w.messages[0]!.status).toBe("SENT");
  });

  it("a second processQueue run after success sends NOTHING again", async () => {
    const w = world();
    await w.dispatcher.dispatchExecution(EXECUTION);
    await w.dispatcher.processQueue("org_1");
    const second = await w.dispatcher.processQueue("org_1");
    expect(w.sends).toBe(1);
    expect(second).toMatchObject({ scanned: 0, sent: 0 });
  });

  it("two racing workers cannot double-send a row (optimistic claim)", async () => {
    const w = world();
    await w.dispatcher.dispatchExecution(EXECUTION);
    // Simulate the race: first claimant wins; the loser gets claim=false.
    const firstClaim = await w.repository.claimMessageForSending("org_1", w.messages[0]!.id, NOW);
    const secondClaim = await w.repository.claimMessageForSending("org_1", w.messages[0]!.id, NOW);
    expect(firstClaim).toBe(true);
    expect(secondClaim).toBe(false);
  });

  it("reprocess → successful send uses a fresh budget exactly once", async () => {
    const w = world();
    await w.dispatcher.dispatchExecution(EXECUTION);
    w.messages[0]!.status = "FAILED";
    w.messages[0]!.attempts = 3;
    const requeued = await w.dispatcher.requeueMessage("org_1", w.messages[0]!.id);
    expect(requeued.requeued).toBe(true);
    expect(w.messages[0]!.attempts).toBe(0);
    await w.dispatcher.processQueue("org_1");
    expect(w.messages[0]!.status).toBe("SENT");
    expect(w.sends).toBe(1);
  });

  it("duplicate plus out-of-order receipts never regress the lifecycle", async () => {
    const w = world();
    await w.dispatcher.dispatchExecution(EXECUTION);
    await w.dispatcher.processQueue("org_1");
    const mid = w.messages[0]!.providerMessageId!;

    const delivered1 = await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "DELIVERED",
      at: NOW,
    });
    const delivered2 = await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "DELIVERED",
      at: NOW,
    });
    const read = await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "READ",
      at: NOW,
    });
    const lateSent = await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "SENT",
      at: NOW,
    });
    const lateDelivered = await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "DELIVERED",
      at: NOW,
    });

    expect(delivered1.applied).toBe(true);
    expect(delivered2.applied).toBe(false);
    expect(read.applied).toBe(true);
    expect(lateSent.applied).toBe(false);
    expect(lateDelivered.applied).toBe(false);
    expect(w.messages[0]!.status).toBe("READ");
  });

  it("webhook-grade audit dedupe: the same external event id is processed once per tenant", async () => {
    const w = world();
    const event = {
      organizationId: "org_1",
      action: "WHATSAPP_READ_RECEIPT",
      entityType: "DeliveryMessage",
      externalEventId: "whatsapp:0:wamid-1:read",
    };
    expect(await w.repository.writeAuditLog(event)).toBe(true);
    expect(await w.repository.writeAuditLog(event)).toBe(false);
    expect(w.audit).toHaveLength(1);
    // Another tenant may legitimately receive the same provider event id.
    expect(await w.repository.writeAuditLog({ ...event, organizationId: "org_2" })).toBe(true);
    expect(w.audit).toHaveLength(2);
  });

  it("a full happy-path run ends exactly at READ with all timestamps set", async () => {
    const w = world();
    await w.dispatcher.dispatchExecution(EXECUTION);
    await w.dispatcher.processQueue("org_1");
    const mid = w.messages[0]!.providerMessageId!;
    await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "DELIVERED",
      at: new Date(NOW.getTime() + 3_000),
    });
    await w.repository.applyProviderReceipt("org_1", {
      providerMessageId: mid,
      target: "READ",
      at: new Date(NOW.getTime() + 9_000),
    });
    const final = w.messages[0]!;
    expect(final.status).toBe("READ");
    expect(final.sentAt).toEqual(NOW);
    expect(final.deliveredAt!.getTime() - final.sentAt!.getTime()).toBe(3_000);
    expect(final.readAt).toBeTruthy();
    expect(final.attempts).toBe(1);
  });
});
