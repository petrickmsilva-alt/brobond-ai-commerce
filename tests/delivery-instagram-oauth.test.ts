import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InstagramOAuthError,
  createInstagramOAuthService,
} from "@/modules/delivery/instagram/auth.service";
import {
  decryptDeliverySecret,
  encryptDeliverySecret,
  hashDeliveryOAuthState,
} from "@/modules/delivery/core/crypto.service";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const KEY = Buffer.alloc(32, 7).toString("base64url");
const NOW = new Date("2026-09-23T12:00:00.000Z");
const CONFIG = {
  appId: "ig-app",
  appSecret: "ig-secret",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v21.0",
};

function fakeRepository() {
  const states: Array<Record<string, unknown>> = [];
  const accounts: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];
  const repository = {
    purgeExpiredOAuthStates: vi.fn(async (_org: string, now: Date) => {
      const before = states.length;
      for (let index = states.length - 1; index >= 0; index -= 1) {
        if ((states[index]!.expiresAt as Date) <= now) states.splice(index, 1);
      }
      return before - states.length;
    }),
    createOAuthState: vi.fn(async (input: Record<string, unknown>) => {
      const state = { id: `st-${states.length + 1}`, createdAt: NOW, ...input };
      states.push(state);
      return state;
    }),
    findOAuthStateByHash: vi.fn(async (stateHash: string) => {
      return states.find((state) => state.stateHash === stateHash) ?? null;
    }),
    consumeOAuthState: vi.fn(async (id: string, now: Date) => {
      const state = states.find((candidate) => candidate.id === id);
      if (!state || (state.expiresAt as Date) <= now) return false;
      states.splice(states.indexOf(state), 1);
      return true;
    }),
    upsertConnectedAccount: vi.fn(async (org: string, input: Record<string, unknown>) => {
      const existing = accounts.find(
        (account) => account.organizationId === org && account.accountId === input.accountId,
      );
      if (existing) {
        Object.assign(existing, input, { status: "CONNECTED" });
        return existing;
      }
      const account = {
        id: `acc-${accounts.length + 1}`,
        organizationId: org,
        createdAt: NOW,
        updatedAt: NOW,
        status: "CONNECTED",
        ...input,
      };
      accounts.push(account);
      return account;
    }),
    findAccountById: vi.fn(async (org: string, pk: string) => {
      return (
        accounts.find((account) => account.id === pk && account.organizationId === org) ?? null
      );
    }),
    findActiveAccount: vi.fn(async (org: string, channel: string) => {
      return (
        accounts.find(
          (account) =>
            account.organizationId === org &&
            account.channel === channel &&
            account.status === "CONNECTED",
        ) ?? null
      );
    }),
    saveTokens: vi.fn(async (_org: string, pk: string, tokens: Record<string, unknown>) => {
      const account = accounts.find((candidate) => candidate.id === pk);
      if (!account) return 0;
      Object.assign(account, tokens, { status: "CONNECTED" });
      return 1;
    }),
    markAccountStatus: vi.fn(async (_org: string, pk: string, status: string) => {
      const account = accounts.find((candidate) => candidate.id === pk);
      if (!account) return 0;
      account.status = status;
      return 1;
    }),
    disconnectAccount: vi.fn(async (org: string, pk: string) => {
      const account = accounts.find(
        (candidate) => candidate.id === pk && candidate.organizationId === org,
      );
      if (!account) return false;
      account.status = "DISCONNECTED";
      account.encryptedAccessToken = null;
      account.encryptedRefreshToken = null;
      account.expiresAt = null;
      return true;
    }),
    writeAuditLog: vi.fn(async (input: Record<string, unknown>) => {
      audit.push(input);
      return true;
    }),
  };
  return { repository, states, accounts, audit };
}

function fakeDb() {
  return {
    deliveryOAuthState: { deleteMany: vi.fn(async () => ({ count: 1 })) },
  };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    exchangeCode: vi.fn(async () => ({ access_token: "short-token", expires_in: 3600 })),
    exchangeForLongLivedToken: vi.fn(async () => ({
      access_token: "long-token",
      expires_in: 5_184_000,
    })),
    refreshLongLivedToken: vi.fn(async () => ({
      access_token: "rotated-token",
      expires_in: 5_184_000,
    })),
    listBusinessAccounts: vi.fn(async () => [{ id: "ig-1", username: "brobond" }]),
    sendDirectMessage: vi.fn(async () => ({ message_id: "mid" })),
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const repo = fakeRepository();
  const db = fakeDb();
  const client = fakeClient();
  const service = createInstagramOAuthService({
    db: db as never,
    repository: repo.repository as never,
    config: CONFIG,
    now: () => NOW,
    randomState: () => "opaque-state",
    client: client as never,
    redirectUri: "https://app.example.com/api/instagram/callback",
    ...overrides,
  });
  return { service, repo, db, client };
}

describe("connectInstagram", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("returns the official Meta dialog URL with state and scopes", async () => {
    const { service } = makeService();
    const { authorizationUrl } = await service.connectInstagram("org_1");
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("ig-app");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/instagram/callback",
    );
    expect(url.searchParams.get("state")).toBe("opaque-state");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("instagram_business_manage_messages");
  });

  it("persists ONLY the hashed state (never the raw value)", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    expect(repo.states).toHaveLength(1);
    expect(repo.states[0]!.stateHash).toBe(hashDeliveryOAuthState("opaque-state"));
    expect(JSON.stringify(repo.states[0])).not.toContain("opaque-state");
  });

  it("state is bound to the tenant and the INSTAGRAM channel with a 10-minute TTL", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    expect(repo.states[0]).toMatchObject({ organizationId: "org_1", channel: "INSTAGRAM" });
    expect((repo.states[0]!.expiresAt as Date).getTime() - NOW.getTime()).toBe(10 * 60 * 1000);
  });

  it("purges expired states before creating a new one", async () => {
    const { service, repo } = makeService();
    repo.states.push({
      id: "old",
      organizationId: "org_1",
      channel: "INSTAGRAM",
      stateHash: "x",
      expiresAt: new Date(NOW.getTime() - 1),
      createdAt: NOW,
    });
    await service.connectInstagram("org_1");
    expect(repo.states).toHaveLength(1);
    expect(repo.states[0]!.stateHash).toBe(hashDeliveryOAuthState("opaque-state"));
  });

  it("rejects a blank tenant scope", async () => {
    const { service } = makeService();
    await expect(service.connectInstagram("")).rejects.toThrow(/organization scope/);
  });
});

describe("exchangeCode (Instagram)", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("completes the flow and stores ONLY AES ciphertext", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    const accounts = await service.exchangeCode({ code: "code-1", state: "opaque-state" });
    expect(accounts).toHaveLength(1);
    const stored = repo.accounts[0]!;
    expect(stored).toMatchObject({
      organizationId: "org_1",
      channel: "INSTAGRAM",
      accountId: "ig-1",
      accountName: "@brobond",
      status: "CONNECTED",
    });
    expect(stored.encryptedAccessToken).toMatch(/^v1\./);
    expect(stored.encryptedAccessToken).not.toContain("long-token");
    expect(decryptDeliverySecret(stored.encryptedAccessToken as string)).toBe("long-token");
  });

  it("connects every discovered Instagram Business account", async () => {
    const client = fakeClient({
      listBusinessAccounts: vi.fn(async () => [
        { id: "ig-1", username: "one" },
        { id: "ig-2", username: "two" },
      ]),
    });
    const { service, repo } = makeService({ client: client as never });
    await service.connectInstagram("org_1");
    const accounts = await service.exchangeCode({ code: "code-1", state: "opaque-state" });
    expect(accounts).toHaveLength(2);
    expect(repo.accounts.map((account) => account.accountId).sort()).toEqual(["ig-1", "ig-2"]);
  });

  it("computes expiry from the long-lived token response", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "code-1", state: "opaque-state" });
    expect((repo.accounts[0]!.expiresAt as Date).getTime()).toBe(NOW.getTime() + 5_184_000 * 1000);
  });

  it("falls back to ~60d when Meta omits expires_in", async () => {
    const client = fakeClient({
      exchangeForLongLivedToken: vi.fn(async () => ({ access_token: "long-token" })),
    });
    const { service, repo } = makeService({ client: client as never });
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "code-1", state: "opaque-state" });
    expect((repo.accounts[0]!.expiresAt as Date).getTime()).toBe(
      NOW.getTime() + 60 * 24 * 60 * 60 * 1000,
    );
  });

  it("consumes the state exactly once (replay is rejected)", async () => {
    const { service } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "code-1", state: "opaque-state" });
    await expect(service.exchangeCode({ code: "code-1", state: "opaque-state" })).rejects.toThrow(
      /invalid or expired/i,
    );
  });

  it("rejects an unknown state", async () => {
    const { service } = makeService();
    await expect(service.exchangeCode({ code: "code-1", state: "nope" })).rejects.toThrow(
      InstagramOAuthError,
    );
  });

  it("rejects an expired state", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    // Force the minted state past its TTL without touching the clock source.
    repo.states[0]!.expiresAt = new Date(NOW.getTime() - 1);
    await expect(service.exchangeCode({ code: "c", state: "opaque-state" })).rejects.toThrow(
      /expired/i,
    );
    expect(repo.accounts).toHaveLength(0);
  });

  it("rejects a state minted for the OTHER channel", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    repo.states[0]!.channel = "WHATSAPP";
    await expect(service.exchangeCode({ code: "c", state: "opaque-state" })).rejects.toThrow(
      InstagramOAuthError,
    );
  });

  it("fails when Meta returns no access token", async () => {
    const client = fakeClient({ exchangeCode: vi.fn(async () => ({})) });
    const { service } = makeService({ client: client as never });
    await service.connectInstagram("org_1");
    await expect(service.exchangeCode({ code: "c", state: "opaque-state" })).rejects.toThrow(
      /access token/i,
    );
  });

  it("fails when no Instagram Business account is linked", async () => {
    const client = fakeClient({ listBusinessAccounts: vi.fn(async () => []) });
    const { service, repo } = makeService({ client: client as never });
    await service.connectInstagram("org_1");
    await expect(service.exchangeCode({ code: "c", state: "opaque-state" })).rejects.toThrow(
      /No Instagram Business account/i,
    );
    expect(repo.accounts).toHaveLength(0);
  });

  it("writes an audit entry without any credential material", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "c", state: "opaque-state" });
    const entry = repo.audit.find((log) => log.action === "INSTAGRAM_CONNECTED");
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain("long-token");
    expect(JSON.stringify(entry)).toContain("ig-1");
  });

  it("re-connecting the same account updates tokens idempotently", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "c", state: "opaque-state" });
    const firstCiphertext = repo.accounts[0]!.encryptedAccessToken;
    repo.repository.findOAuthStateByHash.mockClear();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "c", state: "opaque-state" });
    expect(repo.accounts).toHaveLength(1);
    expect(repo.accounts[0]!.encryptedAccessToken).not.toBe(firstCiphertext);
  });
});

describe("refreshToken / getValidAccessToken (Instagram)", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  async function connectOne() {
    const fixture = makeService();
    await fixture.service.connectInstagram("org_1");
    await fixture.service.exchangeCode({ code: "c", state: "opaque-state" });
    return fixture;
  }

  it("rotates the long-lived token and re-encrypts it", async () => {
    const { service, repo } = await connectOne();
    const before = repo.accounts[0]!.encryptedAccessToken as string;
    const expiresAt = await service.refreshToken("org_1", repo.accounts[0]!.id as string);
    expect(decryptDeliverySecret(repo.accounts[0]!.encryptedAccessToken as string)).toBe(
      "rotated-token",
    );
    expect(repo.accounts[0]!.encryptedAccessToken).not.toBe(before);
    expect(expiresAt?.getTime()).toBe(NOW.getTime() + 5_184_000 * 1000);
  });

  it("marks the account EXPIRED when the refresh fails", async () => {
    const { service, repo, client } = await connectOne();
    client.refreshLongLivedToken.mockRejectedValueOnce(new Error("dead"));
    await expect(service.refreshToken("org_1", repo.accounts[0]!.id as string)).rejects.toThrow(
      InstagramOAuthError,
    );
    expect(repo.accounts[0]!.status).toBe("EXPIRED");
  });

  it("refuses to refresh an unknown tenant account", async () => {
    const { service } = await connectOne();
    await expect(service.refreshToken("org_2", "acc-1")).rejects.toThrow(InstagramOAuthError);
  });

  it("getValidAccessToken returns the plaintext for a fresh token", async () => {
    const { service, repo } = await connectOne();
    const token = await service.getValidAccessToken("org_1", repo.accounts[0]! as never);
    expect(token).toBe("long-token");
  });

  it("getValidAccessToken auto-refreshes a token inside the 5-minute skew", async () => {
    const { service, repo } = await connectOne();
    repo.accounts[0]!.expiresAt = new Date(NOW.getTime() + 60 * 1000);
    const token = await service.getValidAccessToken("org_1", repo.accounts[0]! as never);
    expect(token).toBe("rotated-token");
  });

  it("getValidAccessToken auto-refreshes an already-expired token", async () => {
    const { service, repo } = await connectOne();
    repo.accounts[0]!.expiresAt = new Date(NOW.getTime() - 1000);
    expect(await service.getValidAccessToken("org_1", repo.accounts[0]! as never)).toBe(
      "rotated-token",
    );
  });

  it("getValidAccessToken keeps a non-expiring token as-is", async () => {
    const { service, repo } = await connectOne();
    repo.accounts[0]!.expiresAt = null;
    expect(await service.getValidAccessToken("org_1", repo.accounts[0]! as never)).toBe(
      "long-token",
    );
  });

  it("getValidAccessToken rejects a disconnected account", async () => {
    const { service, repo } = await connectOne();
    repo.accounts[0]!.encryptedAccessToken = null;
    await expect(service.getValidAccessToken("org_1", repo.accounts[0]! as never)).rejects.toThrow(
      /disconnected/i,
    );
  });
});

describe("disconnectInstagram", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("destroys ciphertext and marks the account DISCONNECTED", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "c", state: "opaque-state" });
    const disconnected = await service.disconnectInstagram("org_1", repo.accounts[0]!.id as string);
    expect(disconnected).toBe(true);
    expect(repo.accounts[0]).toMatchObject({
      status: "DISCONNECTED",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      expiresAt: null,
    });
    expect(repo.audit.some((log) => log.action === "INSTAGRAM_DISCONNECTED")).toBe(true);
  });

  it("returns false for a foreign or unknown account and writes no audit", async () => {
    const { service, repo } = makeService();
    await service.connectInstagram("org_1");
    await service.exchangeCode({ code: "c", state: "opaque-state" });
    expect(await service.disconnectInstagram("org_2", repo.accounts[0]!.id as string)).toBe(false);
    expect(await service.disconnectInstagram("org_1", "missing")).toBe(false);
    expect(repo.audit.some((log) => log.action === "INSTAGRAM_DISCONNECTED")).toBe(false);
  });
});
