import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryMessage } from "@prisma/client";
import {
  DeliveryAccountUnavailableError,
  DeliveryDispatchError,
  createDeliveryDispatcher,
} from "@/modules/delivery/queue/dispatcher";
import {
  DeliveryProviderError,
  type CommerceExecutionDeliveryRequest,
  type DeliveryConnector,
} from "@/modules/delivery/core/delivery.interface";
import { encryptDeliverySecret } from "@/modules/delivery/core/crypto.service";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const KEY = Buffer.alloc(32, 13).toString("base64url");
const NOW = new Date("2026-09-23T12:00:00.000Z");

function messageRow(overrides: Partial<DeliveryMessage> = {}): DeliveryMessage {
  return {
    id: "m1",
    organizationId: "org_1",
    executionId: "exec-1",
    channel: "WHATSAPP",
    recipientId: "+5511999",
    recipientName: "Ana",
    status: "QUEUED",
    providerMessageId: null,
    payload: {
      version: 1,
      executionId: "exec-1",
      campaignId: "camp-1",
      campaignName: "Lançamento",
      creatorId: null,
      creatorName: "Ana",
      message: { type: "text", text: "Bem-vinda!" },
    },
    sentAt: null,
    deliveredAt: null,
    readAt: null,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: NOW,
    lastError: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as DeliveryMessage;
}

function fakeRepository(
  options: {
    messages?: DeliveryMessage[];
    connectedAccount?: boolean;
  } = {},
) {
  const messages = [...(options.messages ?? [])];
  const account =
    options.connectedAccount === false
      ? null
      : {
          id: "acc-1",
          organizationId: "org_1",
          channel: "WHATSAPP",
          accountId: "pnid-1",
          accountName: "Brobond",
          encryptedAccessToken: encryptDeliverySecret("plain-provider-token", KEY),
          status: "CONNECTED",
        };
  const calls = {
    markSent: [] as Array<Record<string, unknown>>,
    scheduleRetry: [] as Array<Record<string, unknown>>,
    markFailed: [] as Array<Record<string, unknown>>,
    claimed: [] as string[],
  };
  const repository = {
    enqueueMessage: vi.fn(
      async (org: string, input: { executionId: string; channel: string; recipientId: string }) => {
        const existing = messages.find(
          (message) =>
            message.organizationId === org &&
            message.executionId === input.executionId &&
            message.channel === input.channel &&
            message.recipientId === input.recipientId,
        );
        if (existing) return { message: existing, created: false };
        const created = messageRow({
          id: `m${messages.length + 1}`,
          organizationId: org,
          executionId: input.executionId,
          recipientId: input.recipientId,
        });
        messages.push(created);
        return { message: created, created: true };
      },
    ),
    listDispatchCandidates: vi.fn(async (org: string) =>
      messages.filter((message) => message.organizationId === org && message.status === "QUEUED"),
    ),
    claimMessageForSending: vi.fn(async (org: string, id: string) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || message.organizationId !== org || message.status !== "QUEUED") return false;
      message.status = "SENDING";
      message.attempts += 1;
      calls.claimed.push(id);
      return true;
    }),
    findActiveAccount: vi.fn(async (org: string, channel: string) => {
      if (!account || account.organizationId !== org || account.channel !== channel) return null;
      return account;
    }),
    markSent: vi.fn(
      async (org: string, id: string, input: { providerMessageId: string; sentAt: Date }) => {
        const message = messages.find((candidate) => candidate.id === id);
        if (!message || message.status !== "SENDING") return 0;
        message.status = "SENT";
        message.providerMessageId = input.providerMessageId;
        message.sentAt = input.sentAt;
        calls.markSent.push({ org, id, ...input });
        return 1;
      },
    ),
    scheduleRetry: vi.fn(
      async (org: string, id: string, input: { nextAttemptAt: Date; lastError: string }) => {
        const message = messages.find((candidate) => candidate.id === id);
        if (!message || message.status !== "SENDING") return 0;
        message.status = "QUEUED";
        message.nextAttemptAt = input.nextAttemptAt;
        message.lastError = input.lastError;
        calls.scheduleRetry.push({ org, id, ...input });
        return 1;
      },
    ),
    markFailed: vi.fn(async (org: string, id: string, input: { lastError: string }) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || message.status !== "SENDING") return 0;
      message.status = "FAILED";
      message.lastError = input.lastError;
      calls.markFailed.push({ org, id, ...input });
      return 1;
    }),
    findMessageById: vi.fn(async (org: string, id: string) => {
      return (
        messages.find((message) => message.id === id && message.organizationId === org) ?? null
      );
    }),
    requeueMessage: vi.fn(async (org: string, id: string, now: Date) => {
      const message = messages.find((candidate) => candidate.id === id);
      if (!message || !["FAILED", "CANCELLED"].includes(message.status)) return 0;
      message.status = "QUEUED";
      message.attempts = 0;
      message.nextAttemptAt = now;
      message.lastError = null;
      return 1;
    }),
    writeAuditLog: vi.fn(async () => true),
  };
  const db = {
    deliveryMessage: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organizationId: string; status: string };
          data: Record<string, unknown>;
        }) => {
          const message = messages.find(
            (candidate) =>
              candidate.id === where.id &&
              candidate.organizationId === where.organizationId &&
              candidate.status === where.status,
          );
          if (!message) return { count: 0 };
          Object.assign(message, data);
          return { count: 1 };
        },
      ),
    },
  };
  return { repository, messages, calls, db };
}

function connector(result: { providerMessageId: string } | Error): DeliveryConnector & {
  sendMessage: ReturnType<typeof vi.fn>;
} {
  const sendMessage = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { channel: "WHATSAPP", sendMessage } as never;
}

const EXECUTION: CommerceExecutionDeliveryRequest = {
  organizationId: "org_1",
  executionId: "exec-1",
  status: "APPROVED",
  channel: "WHATSAPP",
  recipientId: "+5511999",
  recipientName: "Ana",
  campaignId: "camp-1",
  campaignName: "Lançamento",
  creatorName: "Ana",
  message: { type: "text", text: "Bem-vinda!" },
};

describe("dispatcher.dispatchExecution (CommerceExecution intake)", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("queues an APPROVED execution as QUEUED", async () => {
    const { repository } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
    });
    const result = await dispatcher.dispatchExecution(EXECUTION);
    expect(result.created).toBe(true);
    expect(result.status).toBe("QUEUED");
  });

  it("persists the denormalized campaign/creator context in the payload", async () => {
    const { repository, messages } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
    });
    await dispatcher.dispatchExecution(EXECUTION);
    expect(messages[0]!.payload).toMatchObject({
      version: 1,
      executionId: "exec-1",
      campaignId: "camp-1",
      campaignName: "Lançamento",
      creatorName: "Ana",
      message: { type: "text", text: "Bem-vinda!" },
    });
  });

  it("rejects non-APPROVED executions (gate)", async () => {
    const { repository } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    for (const status of ["PENDING", "DRAFT", "CANCELLED", ""]) {
      await expect(dispatcher.dispatchExecution({ ...EXECUTION, status })).rejects.toThrow(
        DeliveryDispatchError,
      );
    }
    await expect(dispatcher.dispatchExecution({ ...EXECUTION, status: "PENDING" })).rejects.toThrow(
      /APPROVED/,
    );
  });

  it("rejects executions without ids or recipients", async () => {
    const { repository } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    await expect(dispatcher.dispatchExecution({ ...EXECUTION, executionId: " " })).rejects.toThrow(
      /idempotency/,
    );
    await expect(dispatcher.dispatchExecution({ ...EXECUTION, recipientId: " " })).rejects.toThrow(
      /recipient/,
    );
  });

  it("rejects blank tenant scopes", async () => {
    const { repository } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    await expect(
      dispatcher.dispatchExecution({ ...EXECUTION, organizationId: "" }),
    ).rejects.toThrow(/organization scope/);
  });

  it("is idempotent: replaying the same execution never duplicates", async () => {
    const { repository, messages } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
    });
    const first = await dispatcher.dispatchExecution(EXECUTION);
    const second = await dispatcher.dispatchExecution(EXECUTION);
    const third = await dispatcher.dispatchExecution(EXECUTION);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.messageId).toBe(first.messageId);
    expect(messages).toHaveLength(1);
  });

  it("distinct recipients of the same execution get distinct messages", async () => {
    const { repository, messages } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
    });
    await dispatcher.dispatchExecution(EXECUTION);
    await dispatcher.dispatchExecution({ ...EXECUTION, recipientId: "+5511888" });
    expect(messages).toHaveLength(2);
  });
});

describe("dispatcher.processQueue", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("drives QUEUED → SENDING → SENT with the provider id", async () => {
    const { repository, messages } = fakeRepository({ messages: [messageRow()] });
    const whatsapp = connector({ providerMessageId: "wamid-xyz" });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => whatsapp,
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ scanned: 1, claimed: 1, sent: 1, retries: 0, failed: 0 });
    expect(messages[0]).toMatchObject({ status: "SENT", providerMessageId: "wamid-xyz" });
    expect(messages[0]!.sentAt).toEqual(NOW);
    expect(messages[0]!.attempts).toBe(1);
  });

  it("sends the DECRYPTED token to the connector, never the ciphertext", async () => {
    const { repository } = fakeRepository({ messages: [messageRow()] });
    const whatsapp = connector({ providerMessageId: "wamid-1" });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => whatsapp,
    });
    await dispatcher.processQueue("org_1");
    expect(whatsapp.sendMessage).toHaveBeenCalledWith({
      account: expect.objectContaining({
        accountId: "pnid-1",
        accessToken: "plain-provider-token",
      }),
      recipientId: "+5511999",
      message: { type: "text", text: "Bem-vinda!" },
    });
    const sentToken = (
      whatsapp.sendMessage.mock.calls[0]![0] as { account: { accessToken: string } }
    ).account.accessToken;
    expect(sentToken).not.toContain("v1.");
  });

  it("retries retryable provider failures with exponential backoff", async () => {
    const { repository, messages, calls } = fakeRepository({
      messages: [messageRow({ attempts: 0 })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector(new DeliveryProviderError("rate limited", { status: 429 })),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ sent: 0, retries: 1, failed: 0 });
    expect(messages[0]!.status).toBe("QUEUED");
    expect(messages[0]!.attempts).toBe(1);
    expect(calls.scheduleRetry[0]!.nextAttemptAt).toEqual(new Date(NOW.getTime() + 1_000));
    expect(calls.scheduleRetry[0]!.lastError).toContain("rate limited");
  });

  it("second attempt waits 2s; third failure is terminally FAILED", async () => {
    const { repository, messages, calls } = fakeRepository({
      messages: [messageRow({ attempts: 1 })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector(new DeliveryProviderError("500", { status: 500 })),
    });
    await dispatcher.processQueue("org_1");
    expect(calls.scheduleRetry[0]!.nextAttemptAt).toEqual(new Date(NOW.getTime() + 2_000));

    calls.scheduleRetry.length = 0;
    await dispatcher.processQueue("org_1");
    expect(messages[0]!.status).toBe("FAILED");
    expect(messages[0]!.attempts).toBe(3);
    expect(messages[0]!.lastError).toContain("500");
  });

  it("non-retryable provider errors fail immediately (no backoff)", async () => {
    const { repository, messages, calls } = fakeRepository({ messages: [messageRow()] });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () =>
        connector(new DeliveryProviderError("invalid recipient", { status: 400 })),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ retries: 0, failed: 1 });
    expect(messages[0]!.status).toBe("FAILED");
    expect(calls.scheduleRetry).toHaveLength(0);
  });

  it("a missing CONNECTED account requeues with backoff and counts as missingAccounts", async () => {
    const { repository, messages } = fakeRepository({
      messages: [messageRow()],
      connectedAccount: false,
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector({ providerMessageId: "x" }),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ sent: 0, retries: 1, failed: 0, missingAccounts: 1 });
    expect(messages[0]!.status).toBe("QUEUED");
    expect(messages[0]!.lastError).toContain("No CONNECTED delivery account");
  });

  it("never sends when the active account has no ciphertext", async () => {
    const { repository, messages } = fakeRepository({ messages: [messageRow()] });
    repository.findActiveAccount.mockResolvedValue({
      id: "acc-1",
      organizationId: "org_1",
      channel: "WHATSAPP",
      accountId: "pnid-1",
      accountName: null,
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      expiresAt: null,
      status: "DISCONNECTED",
      createdAt: NOW,
      updatedAt: NOW,
    } as never);
    const whatsapp = connector({ providerMessageId: "x" });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => whatsapp,
    });
    await dispatcher.processQueue("org_1");
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
    expect(messages[0]!.status).toBe("QUEUED");
  });

  it("optimistic claim: a row no longer QUEUED is skipped without sending", async () => {
    const { repository } = fakeRepository({ messages: [messageRow()] });
    repository.claimMessageForSending.mockResolvedValue(false);
    const whatsapp = connector({ providerMessageId: "x" });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => whatsapp,
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ claimed: 0, skipped: 1, sent: 0 });
    expect(whatsapp.sendMessage).not.toHaveBeenCalled();
  });

  it("tenant isolation: other tenants' rows are invisible", async () => {
    const { repository } = fakeRepository({
      messages: [messageRow({ id: "other", organizationId: "org_2" })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector({ providerMessageId: "x" }),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result).toMatchObject({ scanned: 0, claimed: 0, sent: 0 });
  });

  it("a poisoned payload consumes attempts and fails terminally (state error)", async () => {
    const { repository, messages, calls } = fakeRepository({
      messages: [messageRow({ payload: { version: 1 } })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector({ providerMessageId: "x" }),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result.failed).toBe(1);
    expect(messages[0]!.status).toBe("FAILED");
    expect(calls.markFailed[0]!.lastError).toContain("valid message body");
  });

  it("a connector result without provider id is a retryable failure", async () => {
    const { repository, messages } = fakeRepository({ messages: [messageRow()] });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector({ providerMessageId: "" }),
    });
    const result = await dispatcher.processQueue("org_1");
    expect(result.retries).toBe(1);
    expect(messages[0]!.status).toBe("QUEUED");
  });

  it("processes multiple candidates independently", async () => {
    const { repository, messages } = fakeRepository({
      messages: [messageRow({ id: "a" }), messageRow({ id: "b", recipientId: "+5511888" })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
      resolveConnector: () => connector({ providerMessageId: "wamid-batch" }),
    });
    const result = await dispatcher.processQueue("org_1", { limit: 10 });
    expect(result.sent).toBe(2);
    expect(messages.every((message) => message.status === "SENT")).toBe(true);
  });
});

describe("dispatcher.requeueMessage (ADMIN reprocess)", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("requeues FAILED with a fresh attempt budget and audits", async () => {
    const { repository, messages } = fakeRepository({
      messages: [messageRow({ status: "FAILED", attempts: 3, lastError: "x" })],
    });
    const dispatcher = createDeliveryDispatcher({
      repository: repository as never,
      now: () => NOW,
    });
    const result = await dispatcher.requeueMessage("org_1", "m1");
    expect(result.requeued).toBe(true);
    expect(messages[0]).toMatchObject({ status: "QUEUED", attempts: 0, lastError: null });
    expect(repository.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DELIVERY_REQUEUED", entityId: "m1" }),
    );
  });

  it("requeues CANCELLED", async () => {
    const { repository, messages } = fakeRepository({
      messages: [messageRow({ status: "CANCELLED" })],
    });
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    expect((await dispatcher.requeueMessage("org_1", "m1")).requeued).toBe(true);
    expect(messages[0]!.status).toBe("QUEUED");
  });

  it("refuses to requeue live lifecycle states (illegal transition)", async () => {
    const { repository } = fakeRepository({ messages: [messageRow({ status: "READ" })] });
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    await expect(dispatcher.requeueMessage("org_1", "m1")).rejects.toThrow(/Illegal delivery/);
  });

  it("returns requeued:false for unknown or foreign messages", async () => {
    const { repository } = fakeRepository({ messages: [messageRow({ status: "FAILED" })] });
    const dispatcher = createDeliveryDispatcher({ repository: repository as never });
    expect((await dispatcher.requeueMessage("org_2", "m1")).requeued).toBe(false);
    expect((await dispatcher.requeueMessage("org_1", "missing")).requeued).toBe(false);
  });
});

describe("dispatcher.cancelMessage", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("cancels a QUEUED message", async () => {
    const { repository, db, messages } = fakeRepository({ messages: [messageRow()] });
    const dispatcher = createDeliveryDispatcher({
      db: db as never,
      repository: repository as never,
      now: () => NOW,
    });
    expect((await dispatcher.cancelMessage("org_1", "m1")).cancelled).toBe(true);
    expect(messages[0]!.status).toBe("CANCELLED");
    expect(messages[0]!.nextAttemptAt).toBeNull();
  });

  it("refuses to cancel a SENT message (already in provider-hand)", async () => {
    const { repository, db } = fakeRepository({
      messages: [messageRow({ status: "SENT" })],
    });
    const dispatcher = createDeliveryDispatcher({
      db: db as never,
      repository: repository as never,
    });
    await expect(dispatcher.cancelMessage("org_1", "m1")).rejects.toThrow(/Illegal delivery/);
  });

  it("cancel of an unknown message is a no-op", async () => {
    const { repository, db } = fakeRepository();
    const dispatcher = createDeliveryDispatcher({
      db: db as never,
      repository: repository as never,
    });
    expect((await dispatcher.cancelMessage("org_1", "nope")).cancelled).toBe(false);
  });
});

describe("DeliveryAccountUnavailableError", () => {
  it("is a retryable provider error by contract", () => {
    const error = new DeliveryAccountUnavailableError();
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect(error.retryable).toBe(true);
    expect(error.name).toBe("DeliveryAccountUnavailableError");
  });
});
