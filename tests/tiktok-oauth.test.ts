import { beforeEach, describe, expect, it, vi } from "vitest";

// Prevent the module's production singleton from constructing a real Prisma
// client; every OAuth flow below injects a narrow in-memory Prisma surface.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/tenant", () => ({
  tenantWhere: (organizationId: string) => ({ organizationId }),
  scopedWhere: (organizationId: string, where: Record<string, unknown> = {}) => ({
    ...where,
    organizationId,
  }),
}));

import { createTikTokOAuthService } from "@/modules/connectors/tiktok/auth/oauth.service";

const KEY = Buffer.alloc(32, 9).toString("base64url");

type StateRow = { id: string; organizationId: string; stateHash: string; expiresAt: Date };
type AccountRow = Record<string, unknown>;

function fakeDatabase() {
  const states: StateRow[] = [];
  const accounts: AccountRow[] = [];
  const audits: AccountRow[] = [];
  return {
    states,
    accounts,
    audits,
    tikTokOAuthState: {
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const before = states.length;
        const id = where.id as string | undefined;
        const hash = where.stateHash as string | undefined;
        const expiresAt = where.expiresAt as { lte?: Date; gt?: Date } | undefined;
        for (let index = states.length - 1; index >= 0; index -= 1) {
          const state = states[index]!;
          const matches =
            (!id || state.id === id) &&
            (!hash || state.stateHash === hash) &&
            (!expiresAt?.lte || state.expiresAt <= expiresAt.lte) &&
            (!expiresAt?.gt || state.expiresAt > expiresAt.gt);
          if (matches) states.splice(index, 1);
        }
        return { count: before - states.length };
      }),
      create: vi.fn(async ({ data }: { data: StateRow }) => {
        const row = { ...data, id: `state-${states.length + 1}` };
        states.push(row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { stateHash: string } }) =>
          states.find((state) => state.stateHash === where.stateHash) ?? null,
      ),
    },
    tikTokAccount: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const id = where.id as string | undefined;
        const organizationId = where.organizationId as string | undefined;
        return (
          accounts.find(
            (account) =>
              (!id || account.id === id) &&
              (!organizationId || account.organizationId === organizationId),
          ) ?? null
        );
      }),
      findMany: vi.fn(async () => accounts),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { organizationId_shopId: { organizationId: string; shopId: string } };
          create: AccountRow;
          update: AccountRow;
        }) => {
          const existing = accounts.find(
            (account) =>
              account.organizationId === where.organizationId_shopId.organizationId &&
              account.shopId === where.organizationId_shopId.shopId,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row = { ...create, id: `account-${accounts.length + 1}`, createdAt: new Date() };
          accounts.push(row);
          return row;
        },
      ),
      updateMany: vi.fn(
        async ({ where, data }: { where: Record<string, unknown>; data: AccountRow }) => {
          const matched = accounts.filter(
            (account) => account.id === where.id && account.organizationId === where.organizationId,
          );
          matched.forEach((account) => Object.assign(account, data));
          return { count: matched.length };
        },
      ),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: AccountRow }) => {
        audits.push(data);
        return data;
      }),
    },
  };
}

beforeEach(() => {
  process.env.TIKTOK_APP_KEY = "app-key";
  process.env.TIKTOK_APP_SECRET = "app-secret";
  process.env.TIKTOK_ENCRYPTION_KEY = KEY;
  process.env.NEXTAUTH_URL = "https://console.example.test";
});

describe("TikTok OAuth service", () => {
  it("creates a short-lived opaque state and never persists its plaintext", async () => {
    const db = fakeDatabase();
    const service = createTikTokOAuthService({
      db: db as never,
      randomState: () => "state-that-is-long-and-unpredictable-123456",
    });
    const result = await service.connectTikTok("org-1");
    expect(result.authorizationUrl).toContain("service_id=app-key");
    expect(result.authorizationUrl).toContain(
      "redirect_uri=https%3A%2F%2Fconsole.example.test%2Fapi%2Ftiktok%2Fcallback",
    );
    expect(db.states).toHaveLength(1);
    expect(db.states[0]!.stateHash).not.toContain("state-that-is-long");
  });

  it("exchanges a one-time code server-side and persists only encrypted token ciphertext", async () => {
    const db = fakeDatabase();
    const now = new Date("2026-09-23T10:00:00.000Z");
    const service = createTikTokOAuthService({
      db: db as never,
      now: () => now,
      randomState: () => "state-that-is-long-and-unpredictable-123456",
      fetch: async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              access_token: "access-plain",
              refresh_token: "refresh-plain",
              access_token_expire_in: 3600,
            },
          }),
        ),
      apiClient: () =>
        ({
          request: async () => ({ shops: [{ id: "shop-1", cipher: "cipher-1", name: "Loja" }] }),
        }) as never,
    });
    const { authorizationUrl } = await service.connectTikTok("org-1");
    const state = new URL(authorizationUrl).searchParams.get("state")!;
    const accounts = await service.exchangeCode({ code: "code-once", state });
    expect(accounts).toHaveLength(1);
    expect(db.states).toHaveLength(0);
    expect(db.accounts[0]!.accessToken).not.toContain("access-plain");
    expect(db.accounts[0]!.refreshToken).not.toContain("refresh-plain");
    expect(db.accounts[0]!.status).toBe("CONNECTED");
    await expect(service.exchangeCode({ code: "replay", state })).rejects.toThrow(/state/i);
  });

  it("uses TikTok's refresh endpoint and rotates the encrypted credential", async () => {
    const db = fakeDatabase();
    const calls: string[] = [];
    const service = createTikTokOAuthService({
      db: db as never,
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              access_token: "next-access",
              refresh_token: "next-refresh",
              access_token_expire_in: 3600,
            },
          }),
        );
      },
    });
    db.accounts.push({
      id: "account-1",
      organizationId: "org-1",
      accessToken: "v1.ZmFrZQ.ZmFrZQ.ZmFrZQ", // overwritten below by valid exchange fixture
      refreshToken: "v1.ZmFrZQ.ZmFrZQ.ZmFrZQ",
    });
    // Seed through the same encrypted persistence path via a prior OAuth exchange.
    const seeded = createTikTokOAuthService({
      db: db as never,
      randomState: () => "state-that-is-long-and-unpredictable-123456",
      fetch: async () =>
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              access_token: "old-access",
              refresh_token: "old-refresh",
              access_token_expire_in: 3600,
            },
          }),
        ),
      apiClient: () =>
        ({ request: async () => ({ shops: [{ id: "shop-2", cipher: "cipher-2" }] }) }) as never,
    });
    const link = await seeded.connectTikTok("org-1");
    await seeded.exchangeCode({
      code: "code",
      state: new URL(link.authorizationUrl).searchParams.get("state")!,
    });
    const account = db.accounts.find((row) => row.shopId === "shop-2")!;
    await service.refreshAccessToken("org-1", String(account.id));
    expect(calls[0]).toContain("/api/v2/token/refresh");
    expect(account.accessToken).not.toContain("next-access");
    expect(account.refreshToken).not.toContain("next-refresh");
  });
});
