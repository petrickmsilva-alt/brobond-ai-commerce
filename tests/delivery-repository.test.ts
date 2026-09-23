import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeliveryRepository,
  isUniqueConstraintError,
} from "@/modules/delivery/repositories/delivery.repository";
import { AuthorizationError } from "@/lib/rbac";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-09-23T12:00:00.000Z");

interface AnyRow {
  [key: string]: unknown;
}

function matches(row: AnyRow, where: AnyRow): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR" && Array.isArray(value)) {
      return value.some((clause: AnyRow) => matches(row, clause));
    }
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      const filter = value as AnyRow;
      if ("in" in filter && Array.isArray(filter.in))
        return (filter.in as unknown[]).includes(row[key]);
      if ("path" in filter && "equals" in filter && Array.isArray(filter.path)) {
        let cell: unknown = row[key];
        for (const segment of filter.path as string[]) {
          cell = cell && typeof cell === "object" ? (cell as AnyRow)[segment] : undefined;
        }
        return cell === filter.equals;
      }
      if ("lte" in filter || "gte" in filter || "gt" in filter || "lt" in filter) {
        const cell = row[key];
        if (!(cell instanceof Date)) return false;
        if (filter.lte instanceof Date && cell > filter.lte) return false;
        if (filter.gte instanceof Date && cell < filter.gte) return false;
        if (filter.gt instanceof Date && cell <= filter.gt) return false;
        if (filter.lt instanceof Date && cell >= filter.lt) return false;
        return true;
      }
      return matches(row[key] as AnyRow, filter);
    }
    return row[key] === value;
  });
}

function uniqueP2002(): Error & { code: string } {
  const error = new Error("Unique constraint failed") as Error & { code: string };
  error.code = "P2002";
  return error;
}

function fakeDb() {
  const accounts: AnyRow[] = [];
  const messages: AnyRow[] = [];
  const states: AnyRow[] = [];
  const audit: AnyRow[] = [];

  const deliveryAccount = {
    upsert: vi.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { organizationId_channel_accountId: AnyRow };
        create: AnyRow;
        update: AnyRow;
      }) => {
        const key = where.organizationId_channel_accountId;
        const existing = accounts.find(
          (row) =>
            row.organizationId === key.organizationId &&
            row.channel === key.channel &&
            row.accountId === key.accountId,
        );
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row = { id: `acc-${accounts.length + 1}`, createdAt: NOW, updatedAt: NOW, ...create };
        accounts.push(row);
        return row;
      },
    ),
    findUnique: vi.fn(async ({ where }: { where: AnyRow }) => {
      if (where.accountId) return accounts.find((row) => row.accountId === where.accountId) ?? null;
      return null;
    }),
    findFirst: vi.fn(async ({ where }: { where: AnyRow }) => {
      const found = accounts.filter((row) => matches(row, where));
      return found[0] ?? null;
    }),
    findMany: vi.fn(async ({ where, select }: { where: AnyRow; select?: AnyRow }) => {
      const rows = accounts.filter((row) => matches(row, where));
      if (!select) return rows;
      return rows.map((row) =>
        Object.fromEntries(
          Object.keys(select)
            .filter((key) => select[key])
            .map((key) => [key, row[key]]),
        ),
      );
    }),
    updateMany: vi.fn(async ({ where, data }: { where: AnyRow; data: AnyRow }) => {
      const selected = accounts.filter((row) => matches(row, where));
      for (const row of selected) Object.assign(row, data);
      return { count: selected.length };
    }),
  };

  const deliveryOAuthState = {
    create: vi.fn(async ({ data }: { data: AnyRow }) => {
      const row = { id: `st-${states.length + 1}`, createdAt: NOW, ...data };
      states.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: AnyRow }) => {
      return states.find((row) => row.stateHash === where.stateHash) ?? null;
    }),
    deleteMany: vi.fn(async ({ where }: { where: AnyRow }) => {
      const kept = states.filter((row) => !matches(row, where));
      const removed = states.length - kept.length;
      states.length = 0;
      states.push(...kept);
      return { count: removed };
    }),
  };

  const deliveryMessage = {
    findUnique: vi.fn(async ({ where }: { where: AnyRow }) => {
      const unique = where.organizationId_executionId_channel_recipientId as AnyRow | undefined;
      if (unique) {
        return (
          messages.find(
            (row) =>
              row.organizationId === unique.organizationId &&
              row.executionId === unique.executionId &&
              row.channel === unique.channel &&
              row.recipientId === unique.recipientId,
          ) ?? null
        );
      }
      return messages.find((row) => row.id === where.id) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: AnyRow }) => {
      const row: AnyRow = {
        id: `m${messages.length + 1}`,
        providerMessageId: null,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastError: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      };
      const duplicate = messages.find(
        (candidate) =>
          candidate.organizationId === row.organizationId &&
          candidate.executionId === row.executionId &&
          candidate.channel === row.channel &&
          candidate.recipientId === row.recipientId,
      );
      if (duplicate) throw uniqueP2002();
      messages.push(row);
      return row;
    }),
    findFirst: vi.fn(async ({ where }: { where: AnyRow }) => {
      return messages.filter((row) => matches(row, where))[0] ?? null;
    }),
    findMany: vi.fn(
      async ({ where, skip, take }: { where: AnyRow; skip?: number; take?: number }) => {
        const rows = messages.filter((row) => matches(row, where ?? {}));
        const start = skip ?? 0;
        return take === undefined ? rows.slice(start) : rows.slice(start, start + take);
      },
    ),
    updateMany: vi.fn(async ({ where, data }: { where: AnyRow; data: AnyRow }) => {
      const selected = messages.filter((row) => matches(row, where));
      for (const row of selected) {
        const { attempts, ...rest } = data;
        Object.assign(row, rest);
        if (typeof attempts === "number") {
          row.attempts = attempts;
        } else if (
          attempts &&
          typeof attempts === "object" &&
          "increment" in (attempts as AnyRow)
        ) {
          row.attempts = (row.attempts as number) + (attempts as { increment: number }).increment;
        }
      }
      return { count: selected.length };
    }),
    count: vi.fn(async ({ where }: { where?: AnyRow }) => {
      return messages.filter((row) => matches(row, where ?? {})).length;
    }),
    groupBy: vi.fn(async ({ where }: { where: AnyRow }) => {
      const counts = new Map<string, number>();
      for (const row of messages.filter((candidate) => matches(candidate, where))) {
        const status = row.status as string;
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
    }),
  };

  const auditLog = {
    create: vi.fn(async ({ data }: { data: AnyRow }) => {
      if (
        data.externalEventId &&
        audit.some(
          (row) =>
            row.organizationId === data.organizationId &&
            row.externalEventId === data.externalEventId,
        )
      ) {
        throw uniqueP2002();
      }
      const row = { id: `log-${audit.length + 1}`, createdAt: NOW, ...data };
      audit.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where, take }: { where: AnyRow; take?: number }) => {
      return audit.filter((row) => matches(row, where)).slice(0, take ?? audit.length);
    }),
  };

  return {
    db: { deliveryAccount, deliveryOAuthState, deliveryMessage, auditLog },
    accounts,
    messages,
    states,
    audit,
  };
}

describe("Delivery repository — accounts", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createDeliveryRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createDeliveryRepository(fake.db as never);
  });

  it("upserts a connected account for (tenant, channel, accountId)", async () => {
    await repository.upsertConnectedAccount("org_1", {
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: "@shop",
      encryptedAccessToken: "v1.cipher",
      encryptedRefreshToken: null,
      expiresAt: NOW,
    });
    expect(fake.accounts).toHaveLength(1);
    expect(fake.accounts[0]).toMatchObject({ organizationId: "org_1", status: "CONNECTED" });
  });

  it("upsert is idempotent: re-connect updates instead of duplicating", async () => {
    const input = {
      channel: "INSTAGRAM" as const,
      accountId: "ig-1",
      accountName: "@shop",
      encryptedAccessToken: "v1.a",
      encryptedRefreshToken: null,
      expiresAt: NOW,
    };
    await repository.upsertConnectedAccount("org_1", input);
    await repository.upsertConnectedAccount("org_1", { ...input, encryptedAccessToken: "v1.b" });
    expect(fake.accounts).toHaveLength(1);
    expect(fake.accounts[0]!.encryptedAccessToken).toBe("v1.b");
  });

  it("two tenants may connect the same provider account independently", async () => {
    const input = {
      channel: "WHATSAPP" as const,
      accountId: "pnid-1",
      accountName: null,
      encryptedAccessToken: "v1.a",
      encryptedRefreshToken: null,
      expiresAt: null,
    };
    await repository.upsertConnectedAccount("org_1", input);
    await repository.upsertConnectedAccount("org_2", input);
    expect(fake.accounts).toHaveLength(2);
  });

  it("findAccountByProviderAccountId resolves ANY tenant (webhook resolution)", async () => {
    await repository.upsertConnectedAccount("org_9", {
      channel: "INSTAGRAM",
      accountId: "ig-global",
      accountName: null,
      encryptedAccessToken: "v1.a",
      encryptedRefreshToken: null,
      expiresAt: null,
    });
    const account = await repository.findAccountByProviderAccountId("ig-global");
    expect(account).toMatchObject({ organizationId: "org_9" });
    expect(await repository.findAccountByProviderAccountId("missing")).toBeNull();
    expect(await repository.findAccountByProviderAccountId("")).toBeNull();
  });

  it("findActiveAccount only returns CONNECTED accounts of the tenant+channel", async () => {
    fake.accounts.push(
      {
        id: "a1",
        organizationId: "org_1",
        channel: "INSTAGRAM",
        accountId: "ig-1",
        status: "CONNECTED",
        updatedAt: NOW,
        createdAt: NOW,
      },
      {
        id: "a2",
        organizationId: "org_1",
        channel: "INSTAGRAM",
        accountId: "ig-2",
        status: "DISCONNECTED",
        updatedAt: NOW,
        createdAt: NOW,
      },
      {
        id: "a3",
        organizationId: "org_2",
        channel: "INSTAGRAM",
        accountId: "ig-3",
        status: "CONNECTED",
        updatedAt: NOW,
        createdAt: NOW,
      },
      {
        id: "a4",
        organizationId: "org_1",
        channel: "WHATSAPP",
        accountId: "p4",
        status: "CONNECTED",
        updatedAt: NOW,
        createdAt: NOW,
      },
    );
    expect((await repository.findActiveAccount("org_1", "INSTAGRAM"))!.id).toBe("a1");
    expect((await repository.findActiveAccount("org_1", "WHATSAPP"))!.id).toBe("a4");
    expect(await repository.findActiveAccount("org_3", "INSTAGRAM")).toBeNull();
  });

  it("findAccountById is tenant-scoped", async () => {
    fake.accounts.push({
      id: "a1",
      organizationId: "org_1",
      channel: "INSTAGRAM",
      accountId: "ig-1",
      status: "CONNECTED",
    });
    expect(await repository.findAccountById("org_1", "a1")).toBeTruthy();
    expect(await repository.findAccountById("org_2", "a1")).toBeNull();
  });

  it("listAccounts never selects ciphertext columns", async () => {
    await repository.upsertConnectedAccount("org_1", {
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: null,
      encryptedAccessToken: "v1.super-secret",
      encryptedRefreshToken: "v1.refresh-secret",
      expiresAt: null,
    });
    const rows = await repository.listAccounts("org_1");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("v1.super-secret");
    expect(JSON.stringify(rows[0])).not.toContain("v1.refresh-secret");
    expect(rows[0]).not.toHaveProperty("encryptedAccessToken");
  });

  it("disconnectAccount wipes credentials and flips status", async () => {
    await repository.upsertConnectedAccount("org_1", {
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: null,
      encryptedAccessToken: "v1.a",
      encryptedRefreshToken: "v1.b",
      expiresAt: NOW,
    });
    expect(await repository.disconnectAccount("org_1", fake.accounts[0]!.id as string)).toBe(true);
    expect(fake.accounts[0]).toMatchObject({
      status: "DISCONNECTED",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      expiresAt: null,
    });
    expect(await repository.disconnectAccount("org_2", fake.accounts[0]!.id as string)).toBe(false);
  });

  it("saveTokens and markAccountStatus are tenant-scoped", async () => {
    await repository.upsertConnectedAccount("org_1", {
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: null,
      encryptedAccessToken: "v1.a",
      encryptedRefreshToken: null,
      expiresAt: null,
    });
    const id = fake.accounts[0]!.id as string;
    expect(
      await repository.saveTokens("org_1", id, {
        encryptedAccessToken: "v1.new",
        encryptedRefreshToken: null,
        expiresAt: NOW,
      }),
    ).toBe(1);
    expect(fake.accounts[0]!.encryptedAccessToken).toBe("v1.new");
    expect(
      await repository.saveTokens("org_2", id, {
        encryptedAccessToken: "v1.hack",
        encryptedRefreshToken: null,
        expiresAt: null,
      }),
    ).toBe(0);
    expect(await repository.markAccountStatus("org_1", id, "EXPIRED")).toBe(1);
    expect(await repository.markAccountStatus("org_2", id, "EXPIRED")).toBe(0);
  });
});

describe("Delivery repository — OAuth states", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createDeliveryRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createDeliveryRepository(fake.db as never);
  });

  it("creates, finds and consumes a state exactly once while valid", async () => {
    await repository.createOAuthState({
      organizationId: "org_1",
      channel: "WHATSAPP",
      stateHash: "hash-1",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const found = await repository.findOAuthStateByHash("hash-1");
    expect(found).toBeTruthy();
    expect(await repository.consumeOAuthState(found!.id, NOW)).toBe(true);
    expect(await repository.consumeOAuthState(found!.id, NOW)).toBe(false);
  });

  it("refuses to consume an expired state", async () => {
    await repository.createOAuthState({
      organizationId: "org_1",
      channel: "WHATSAPP",
      stateHash: "hash-2",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const found = await repository.findOAuthStateByHash("hash-2");
    const later = new Date(NOW.getTime() + 120_000);
    expect(await repository.consumeOAuthState(found!.id, later)).toBe(false);
    expect(fake.states).toHaveLength(1);
  });

  it("purge is tenant-scoped and only removes expired rows", async () => {
    await repository.createOAuthState({
      organizationId: "org_1",
      channel: "INSTAGRAM",
      stateHash: "a",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    await repository.createOAuthState({
      organizationId: "org_1",
      channel: "INSTAGRAM",
      stateHash: "b",
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    await repository.createOAuthState({
      organizationId: "org_2",
      channel: "INSTAGRAM",
      stateHash: "c",
      expiresAt: new Date(NOW.getTime() - 1),
    });
    const purged = await repository.purgeExpiredOAuthStates("org_1", NOW);
    expect(purged).toBe(1);
    expect(fake.states).toHaveLength(2);
    expect(fake.states.map((row) => row.stateHash).sort()).toEqual(["b", "c"]);
  });
});

describe("Delivery repository — messages", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createDeliveryRepository>;

  const enqueueBase = {
    executionId: "exec-1",
    channel: "WHATSAPP" as const,
    recipientId: "+5511999",
    recipientName: "Ana",
    payload: { message: { type: "text", text: "hi" } } as never,
  };

  beforeEach(() => {
    fake = fakeDb();
    repository = createDeliveryRepository(fake.db as never);
  });

  it("enqueue creates a QUEUED message with the idempotency key", async () => {
    const { message, created } = await repository.enqueueMessage("org_1", {
      ...enqueueBase,
      queuedAt: NOW,
    });
    expect(created).toBe(true);
    expect(message).toMatchObject({ status: "QUEUED", attempts: 0, organizationId: "org_1" });
    expect(message.nextAttemptAt).toEqual(NOW);
  });

  it("enqueue is idempotent on (tenant, execution, channel, recipient)", async () => {
    const first = await repository.enqueueMessage("org_1", enqueueBase);
    const second = await repository.enqueueMessage("org_1", enqueueBase);
    expect(second.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);
    expect(fake.messages).toHaveLength(1);
  });

  it("the same execution key in another tenant is independent", async () => {
    await repository.enqueueMessage("org_1", enqueueBase);
    const other = await repository.enqueueMessage("org_2", enqueueBase);
    expect(other.created).toBe(true);
    expect(fake.messages).toHaveLength(2);
  });

  it("a unique-constraint race resolves to the winning row (created:false)", async () => {
    // Simulate a concurrent insert: findUnique sees nothing, create throws P2002.
    const original = fake.db.deliveryMessage.findUnique;
    let calls = 0;
    fake.db.deliveryMessage.findUnique = vi.fn(async (args: never) => {
      calls += 1;
      if (calls === 1) return null; // pre-check: nothing
      return original(args); // post-race read sees the winner
    }) as never;
    fake.messages.push({
      id: "winner",
      organizationId: "org_1",
      executionId: "exec-1",
      channel: "WHATSAPP",
      recipientId: "+5511999",
      status: "QUEUED",
      payload: {},
    });
    const result = await repository.enqueueMessage("org_1", enqueueBase);
    expect(result.created).toBe(false);
    expect(result.message.id).toBe("winner");
  });

  it("listDispatchCandidates returns only due, tenant-scoped QUEUED rows", async () => {
    fake.messages.push(
      {
        id: "due",
        organizationId: "org_1",
        status: "QUEUED",
        nextAttemptAt: new Date(NOW.getTime() - 1),
        createdAt: NOW,
      },
      {
        id: "future",
        organizationId: "org_1",
        status: "QUEUED",
        nextAttemptAt: new Date(NOW.getTime() + 60_000),
        createdAt: NOW,
      },
      {
        id: "nullDue",
        organizationId: "org_1",
        status: "QUEUED",
        nextAttemptAt: null,
        createdAt: NOW,
      },
      { id: "sent", organizationId: "org_1", status: "SENT", nextAttemptAt: null, createdAt: NOW },
      {
        id: "other",
        organizationId: "org_2",
        status: "QUEUED",
        nextAttemptAt: null,
        createdAt: NOW,
      },
    );
    const candidates = await repository.listDispatchCandidates("org_1", { now: NOW });
    expect(candidates.map((row) => row.id).sort()).toEqual(["due", "nullDue"]);
  });

  it("claimMessageForSending flips QUEUED → SENDING once and consumes an attempt", async () => {
    fake.messages.push({ id: "m1", organizationId: "org_1", status: "QUEUED", attempts: 0 });
    expect(await repository.claimMessageForSending("org_1", "m1", NOW)).toBe(true);
    expect(fake.messages[0]).toMatchObject({ status: "SENDING", attempts: 1, lastAttemptAt: NOW });
    expect(await repository.claimMessageForSending("org_1", "m1", NOW)).toBe(false);
    expect(await repository.claimMessageForSending("org_2", "m1", NOW)).toBe(false);
  });

  it("markSent attaches provider id and clears scheduling", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "SENDING",
      nextAttemptAt: NOW,
      lastError: "x",
    });
    expect(
      await repository.markSent("org_1", "m1", { providerMessageId: "wamid-1", sentAt: NOW }),
    ).toBe(1);
    expect(fake.messages[0]).toMatchObject({
      status: "SENT",
      providerMessageId: "wamid-1",
      sentAt: NOW,
      nextAttemptAt: null,
      lastError: null,
    });
    expect(
      await repository.markSent("org_1", "m1", { providerMessageId: "wamid-2", sentAt: NOW }),
    ).toBe(0);
  });

  it("scheduleRetry keeps the message QUEUED with a fresh deadline", async () => {
    fake.messages.push({ id: "m1", organizationId: "org_1", status: "SENDING" });
    const next = new Date(NOW.getTime() + 2_000);
    expect(
      await repository.scheduleRetry("org_1", "m1", { nextAttemptAt: next, lastError: "429" }),
    ).toBe(1);
    expect(fake.messages[0]).toMatchObject({
      status: "QUEUED",
      nextAttemptAt: next,
      lastError: "429",
    });
  });

  it("markFailed is terminal and clears scheduling", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "SENDING",
      nextAttemptAt: NOW,
    });
    expect(await repository.markFailed("org_1", "m1", { lastError: "400 bad" })).toBe(1);
    expect(fake.messages[0]).toMatchObject({ status: "FAILED", nextAttemptAt: null });
  });

  it("requeueMessage only revives FAILED/CANCELLED with attempts reset", async () => {
    fake.messages.push(
      { id: "f", organizationId: "org_1", status: "FAILED", attempts: 3, lastError: "x" },
      { id: "c", organizationId: "org_1", status: "CANCELLED", attempts: 1 },
      { id: "s", organizationId: "org_1", status: "SENT", attempts: 1 },
    );
    expect(await repository.requeueMessage("org_1", "f", NOW)).toBe(1);
    expect(await repository.requeueMessage("org_1", "c", NOW)).toBe(1);
    expect(await repository.requeueMessage("org_1", "s", NOW)).toBe(0);
    expect(fake.messages[0]).toMatchObject({ status: "QUEUED", attempts: 0, lastError: null });
    expect(fake.messages[2]!.status).toBe("SENT");
  });

  it("applyProviderReceipt advances SENT → DELIVERED with the receipt time", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "SENT",
      providerMessageId: "wamid-1",
    });
    const at = new Date(NOW.getTime() + 5_000);
    const result = await repository.applyProviderReceipt("org_1", {
      providerMessageId: "wamid-1",
      target: "DELIVERED",
      at,
    });
    expect(result.applied).toBe(true);
    expect(fake.messages[0]).toMatchObject({ status: "DELIVERED", deliveredAt: at });
  });

  it("applyProviderReceipt never regresses READ → DELIVERED (idempotent receipts)", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "READ",
      providerMessageId: "wamid-1",
      readAt: NOW,
      deliveredAt: null,
    });
    const result = await repository.applyProviderReceipt("org_1", {
      providerMessageId: "wamid-1",
      target: "DELIVERED",
      at: new Date(NOW.getTime() + 9_999),
    });
    expect(result.applied).toBe(false);
    expect(fake.messages[0]!.status).toBe("READ");
    expect(fake.messages[0]!.deliveredAt).toBeNull();
  });

  it("applyProviderReceipt SENT sets sentAt; READ sets readAt", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "SENDING",
      providerMessageId: "a",
    });
    const sent = await repository.applyProviderReceipt("org_1", {
      providerMessageId: "a",
      target: "SENT",
      at: NOW,
    });
    expect(sent.applied).toBe(true);
    expect(fake.messages[0]!.sentAt).toEqual(NOW);
    const read = await repository.applyProviderReceipt("org_1", {
      providerMessageId: "a",
      target: "READ",
      at: NOW,
    });
    expect(read.applied).toBe(true);
    expect(fake.messages[0]!.readAt).toEqual(NOW);
  });

  it("applyProviderReceipt is tenant-scoped and ignores unknown mids", async () => {
    fake.messages.push({
      id: "m1",
      organizationId: "org_1",
      status: "SENT",
      providerMessageId: "wamid-1",
    });
    expect(
      (
        await repository.applyProviderReceipt("org_2", {
          providerMessageId: "wamid-1",
          target: "READ",
          at: NOW,
        })
      ).applied,
    ).toBe(false);
    expect(
      (
        await repository.applyProviderReceipt("org_1", {
          providerMessageId: "nope",
          target: "READ",
          at: NOW,
        })
      ).applied,
    ).toBe(false);
    expect(fake.messages[0]!.status).toBe("SENT");
  });

  it("applyProviderFailure transitions QUEUED/SENDING/SENT to FAILED", async () => {
    for (const status of ["QUEUED", "SENDING", "SENT"] as const) {
      const local = fakeDb();
      const repo = createDeliveryRepository(local.db as never);
      local.messages.push({ id: "m1", organizationId: "org_1", status, providerMessageId: "w" });
      const result = await repo.applyProviderFailure("org_1", {
        providerMessageId: "w",
        at: NOW,
        lastError: "boom",
      });
      expect(result.applied).toBe(true);
      expect(local.messages[0]).toMatchObject({ status: "FAILED", lastError: "boom" });
    }
  });

  it("applyProviderFailure never touches DELIVERED/READ/FAILED", async () => {
    for (const status of ["DELIVERED", "READ", "FAILED", "CANCELLED"] as const) {
      const local = fakeDb();
      const repo = createDeliveryRepository(local.db as never);
      local.messages.push({ id: "m1", organizationId: "org_1", status, providerMessageId: "w" });
      expect(
        (
          await repo.applyProviderFailure("org_1", {
            providerMessageId: "w",
            at: NOW,
            lastError: "x",
          })
        ).applied,
      ).toBe(false);
      expect(local.messages[0]!.status).toBe(status);
    }
  });
});

describe("Delivery repository — dashboard projections", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createDeliveryRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createDeliveryRepository(fake.db as never);
  });

  function seed() {
    fake.messages.push(
      {
        id: "1",
        organizationId: "org_1",
        channel: "WHATSAPP",
        status: "QUEUED",
        payload: { campaignId: "c1", campaignName: "One" },
        createdAt: NOW,
      },
      {
        id: "2",
        organizationId: "org_1",
        channel: "WHATSAPP",
        status: "SENT",
        payload: { campaignId: "c1", campaignName: "One" },
        createdAt: NOW,
      },
      {
        id: "3",
        organizationId: "org_1",
        channel: "INSTAGRAM",
        status: "READ",
        payload: { campaignId: "c2", campaignName: "Two" },
        createdAt: NOW,
      },
      {
        id: "4",
        organizationId: "org_1",
        channel: "INSTAGRAM",
        status: "FAILED",
        payload: {},
        createdAt: NOW,
      },
      {
        id: "5",
        organizationId: "org_2",
        channel: "WHATSAPP",
        status: "SENT",
        payload: { campaignId: "c9", campaignName: "Other" },
        createdAt: NOW,
      },
    );
  }

  it("statusCounts groups per status inside the tenant", async () => {
    seed();
    const counts = await repository.statusCounts("org_1");
    expect(counts).toMatchObject({ QUEUED: 1, SENT: 1, READ: 1, FAILED: 1 });
    expect(counts.WHATSAPP).toBeUndefined();
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(4);
  });

  it("listMessages filters by channel, status and paginates", async () => {
    seed();
    const whatsapp = await repository.listMessages("org_1", { channel: "WHATSAPP" });
    expect(whatsapp.total).toBe(2);
    const read = await repository.listMessages("org_1", { status: "READ" });
    expect(read.total).toBe(1);
    const page = await repository.listMessages("org_1", { page: 2, pageSize: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(4);
  });

  it("listMessages is strictly tenant-scoped", async () => {
    seed();
    const { total } = await repository.listMessages("org_2", {});
    expect(total).toBe(1);
  });

  it("listMessages filters by campaign payload", async () => {
    seed();
    const { total } = await repository.listMessages("org_1", { campaignId: "c2" });
    expect(total).toBe(1);
  });

  it("listCampaignFacets dedupes campaign ids with names", async () => {
    seed();
    const facets = await repository.listCampaignFacets("org_1");
    expect(facets).toEqual([
      { campaignId: "c1", campaignName: "One" },
      { campaignId: "c2", campaignName: "Two" },
    ]);
  });

  it("aggregateDeliveryUsage counts receipt-dated rows for the period", async () => {
    const inPeriod = new Date("2026-09-10T00:00:00Z");
    const outside = new Date("2026-08-01T00:00:00Z");
    fake.messages.push(
      {
        id: "1",
        organizationId: "org_1",
        status: "DELIVERED",
        sentAt: inPeriod,
        deliveredAt: inPeriod,
        readAt: null,
        updatedAt: inPeriod,
      },
      {
        id: "2",
        organizationId: "org_1",
        status: "READ",
        sentAt: inPeriod,
        deliveredAt: inPeriod,
        readAt: inPeriod,
        updatedAt: inPeriod,
      },
      { id: "3", organizationId: "org_1", status: "FAILED", sentAt: null, updatedAt: inPeriod },
      { id: "4", organizationId: "org_1", status: "QUEUED", updatedAt: inPeriod },
      { id: "5", organizationId: "org_1", status: "SENT", sentAt: outside, updatedAt: outside },
      {
        id: "6",
        organizationId: "org_2",
        status: "READ",
        sentAt: inPeriod,
        deliveredAt: inPeriod,
        readAt: inPeriod,
        updatedAt: inPeriod,
      },
    );
    const usage = await repository.aggregateDeliveryUsage("org_1", {
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-23T00:00:00Z"),
    });
    expect(usage).toMatchObject({
      messagesSent: 2,
      messagesDelivered: 2,
      messagesRead: 1,
      messagesFailed: 1,
      messagesQueued: 1,
    });
  });
});

describe("Delivery repository — audit + tenant guards", () => {
  let fake: ReturnType<typeof fakeDb>;
  let repository: ReturnType<typeof createDeliveryRepository>;

  beforeEach(() => {
    fake = fakeDb();
    repository = createDeliveryRepository(fake.db as never);
  });

  it("writeAuditLog records an entry inside the tenant", async () => {
    expect(
      await repository.writeAuditLog({
        organizationId: "org_1",
        action: "INSTAGRAM_CONNECTED",
        entityType: "DeliveryAccount",
      }),
    ).toBe(true);
    expect(fake.audit[0]).toMatchObject({ organizationId: "org_1", action: "INSTAGRAM_CONNECTED" });
  });

  it("writeAuditLog dedupes on (tenant, externalEventId) returning false", async () => {
    const input = {
      organizationId: "org_1",
      action: "INSTAGRAM_READ_RECEIPT",
      entityType: "DeliveryMessage",
      externalEventId: "instagram:1:mid:READ",
    };
    expect(await repository.writeAuditLog(input)).toBe(true);
    expect(await repository.writeAuditLog(input)).toBe(false);
    expect(fake.audit).toHaveLength(1);
  });

  it("the same externalEventId in another tenant is independent", async () => {
    const base = { action: "X", entityType: "DeliveryMessage", externalEventId: "k" };
    expect(await repository.writeAuditLog({ ...base, organizationId: "org_1" })).toBe(true);
    expect(await repository.writeAuditLog({ ...base, organizationId: "org_2" })).toBe(true);
    expect(fake.audit).toHaveLength(2);
  });

  it("writeAuditLog rejects a blank tenant (defense in depth)", async () => {
    await expect(
      repository.writeAuditLog({ organizationId: "", action: "X", entityType: "DeliveryMessage" }),
    ).rejects.toThrow(AuthorizationError);
  });

  it("writeAuditLog rethrows non-unique errors", async () => {
    fake.db.auditLog.create.mockRejectedValueOnce(new Error("db down"));
    await expect(
      repository.writeAuditLog({ organizationId: "org_1", action: "X", entityType: "T" }),
    ).rejects.toThrow("db down");
  });

  it("listAuditLogs is tenant-scoped and limited", async () => {
    for (let index = 0; index < 25; index += 1) {
      fake.audit.push({
        id: `a${index}`,
        organizationId: "org_1",
        action: "X",
        entityType: "T",
        createdAt: NOW,
      });
    }
    fake.audit.push({
      id: "other",
      organizationId: "org_2",
      action: "X",
      entityType: "T",
      createdAt: NOW,
    });
    const logs = await repository.listAuditLogs("org_1", 10);
    expect(logs).toHaveLength(10);
    expect(logs.every((log: { organizationId: string }) => log.organizationId === "org_1")).toBe(
      true,
    );
  });

  it("isUniqueConstraintError only matches P2002", () => {
    expect(isUniqueConstraintError(Object.assign(new Error("x"), { code: "P2002" }))).toBe(true);
    expect(isUniqueConstraintError(Object.assign(new Error("x"), { code: "P2025" }))).toBe(false);
    expect(isUniqueConstraintError(new Error("plain"))).toBe(false);
    expect(isUniqueConstraintError("P2002")).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });

  it("tenant-scoped methods reject a blank organizationId", async () => {
    await expect(
      repository.upsertConnectedAccount("", {
        channel: "INSTAGRAM",
        accountId: "x",
        accountName: null,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        expiresAt: null,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      repository.enqueueMessage("", {
        executionId: "e",
        channel: "WHATSAPP",
        recipientId: "r",
        payload: {} as never,
      }),
    ).rejects.toThrow(AuthorizationError);
    await expect(repository.listMessages("  ", {})).rejects.toThrow(AuthorizationError);
  });
});
