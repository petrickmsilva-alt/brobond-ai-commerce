import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WhatsAppOAuthError,
  createWhatsAppOAuthService,
  getWhatsAppPhoneNumberId,
} from "@/modules/delivery/whatsapp/auth.service";
import {
  decryptDeliverySecret,
  hashDeliveryOAuthState,
} from "@/modules/delivery/core/crypto.service";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const KEY = Buffer.alloc(32, 11).toString("base64url");
const NOW = new Date("2026-09-23T12:00:00.000Z");
const CONFIG = {
  appId: "wa-app",
  appSecret: "wa-secret",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v21.0",
};

function fakeRepository() {
  const states: Array<Record<string, unknown>> = [];
  const accounts: Array<Record<string, unknown>> = [];
  const audit: Array<Record<string, unknown>> = [];
  const repository = {
    purgeExpiredOAuthStates: vi.fn(async () => 0),
    createOAuthState: vi.fn(async (input: Record<string, unknown>) => {
      const state = { id: `st-${states.length + 1}`, createdAt: NOW, ...input };
      states.push(state);
      return state;
    }),
    findOAuthStateByHash: vi.fn(async (stateHash: string) => {
      return states.find((state) => state.stateHash === stateHash) ?? null;
    }),
    consumeOAuthState: vi.fn(async (id: string) => {
      const state = states.find((candidate) => candidate.id === id);
      if (!state) return false;
      states.splice(states.indexOf(state), 1);
      return true;
    }),
    upsertConnectedAccount: vi.fn(async (org: string, input: Record<string, unknown>) => {
      const account = {
        id: `acc-${accounts.length + 1}`,
        organizationId: org,
        status: "CONNECTED",
        createdAt: NOW,
        updatedAt: NOW,
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
    disconnectAccount: vi.fn(async (org: string, pk: string) => {
      const account = accounts.find(
        (candidate) => candidate.id === pk && candidate.organizationId === org,
      );
      if (!account) return false;
      account.status = "DISCONNECTED";
      account.encryptedAccessToken = null;
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
  return { deliveryOAuthState: { deleteMany: vi.fn(async () => ({ count: 1 })) } };
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    exchangeToken: vi.fn(async () => ({ access_token: "wa-token" })),
    getPhoneNumberInfo: vi.fn(async () => ({
      id: "pnid-1",
      display_phone_number: "+55 11 99999-0000",
      verified_name: "Brobond Oficial",
    })),
    ...overrides,
  };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const repo = fakeRepository();
  const client = fakeClient();
  const service = createWhatsAppOAuthService({
    db: fakeDb() as never,
    repository: repo.repository as never,
    config: CONFIG,
    now: () => NOW,
    randomState: () => "wa-state",
    client: client as never,
    redirectUri: "https://app.example.com/api/whatsapp/callback",
    phoneNumberId: "pnid-1",
    ...overrides,
  });
  return { service, repo, client };
}

describe("connectWhatsApp", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("returns the official Meta dialog URL with the WhatsApp scopes", async () => {
    const { service } = makeService();
    const { authorizationUrl } = await service.connectWhatsApp("org_1");
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("wa-app");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/whatsapp/callback",
    );
    expect(url.searchParams.get("state")).toBe("wa-state");
    expect(url.searchParams.get("scope")).toContain("whatsapp_business_messaging");
  });

  it("persists only the hashed state, bound to tenant + WHATSAPP channel", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    expect(repo.states[0]).toMatchObject({ organizationId: "org_1", channel: "WHATSAPP" });
    expect(repo.states[0]!.stateHash).toBe(hashDeliveryOAuthState("wa-state"));
    expect(JSON.stringify(repo.states)).not.toContain('"wa-state"');
  });
});

describe("exchangeToken (WhatsApp)", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("verifies the sender and stores ONLY AES ciphertext", async () => {
    const { service, repo, client } = makeService();
    await service.connectWhatsApp("org_1");
    const account = await service.exchangeToken({ code: "c1", state: "wa-state" });
    expect(client.getPhoneNumberInfo).toHaveBeenCalledWith("pnid-1", "wa-token");
    expect(account).toMatchObject({
      channel: "WHATSAPP",
      accountId: "pnid-1",
      accountName: "Brobond Oficial",
      status: "CONNECTED",
    });
    const stored = repo.accounts[0]!;
    expect(stored.encryptedAccessToken).toMatch(/^v1\./);
    expect(decryptDeliverySecret(stored.encryptedAccessToken as string)).toBe("wa-token");
  });

  it("non-expiring tokens keep expiresAt null", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    expect(repo.accounts[0]!.expiresAt).toBeNull();
  });

  it("honours an expires_in when Meta provides one", async () => {
    const client = fakeClient({
      exchangeToken: vi.fn(async () => ({ access_token: "tok", expires_in: 7200 })),
    });
    const { service, repo } = makeService({ client: client as never });
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    expect((repo.accounts[0]!.expiresAt as Date).getTime()).toBe(NOW.getTime() + 7200 * 1000);
  });

  it("consumes the state exactly once", async () => {
    const { service } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    await expect(service.exchangeToken({ code: "c1", state: "wa-state" })).rejects.toThrow(
      WhatsAppOAuthError,
    );
  });

  it("rejects a state minted for another channel", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    repo.states[0]!.channel = "INSTAGRAM";
    await expect(service.exchangeToken({ code: "c1", state: "wa-state" })).rejects.toThrow(
      WhatsAppOAuthError,
    );
  });

  it("fails when Meta omits the access token", async () => {
    const client = fakeClient({ exchangeToken: vi.fn(async () => ({})) });
    const { service } = makeService({ client: client as never });
    await service.connectWhatsApp("org_1");
    await expect(service.exchangeToken({ code: "c1", state: "wa-state" })).rejects.toThrow(
      /access token/i,
    );
  });

  it("fails when the phone number cannot be verified", async () => {
    const client = fakeClient({ getPhoneNumberInfo: vi.fn(async () => ({})) });
    const { service, repo } = makeService({ client: client as never });
    await service.connectWhatsApp("org_1");
    await expect(service.exchangeToken({ code: "c1", state: "wa-state" })).rejects.toThrow(
      /could not be verified/i,
    );
    expect(repo.accounts).toHaveLength(0);
  });

  it("requires WHATSAPP_PHONE_NUMBER_ID when no override is injected", () => {
    const original = process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    try {
      expect(() => getWhatsAppPhoneNumberId()).toThrow(/WHATSAPP_PHONE_NUMBER_ID/);
      process.env.WHATSAPP_PHONE_NUMBER_ID = "  env-pnid  ";
      expect(getWhatsAppPhoneNumberId()).toBe("env-pnid");
    } finally {
      if (original === undefined) delete process.env.WHATSAPP_PHONE_NUMBER_ID;
      else process.env.WHATSAPP_PHONE_NUMBER_ID = original;
    }
  });

  it("writes a WHATSAPP_CONNECTED audit without credentials", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    const entry = repo.audit.find((log) => log.action === "WHATSAPP_CONNECTED");
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain("wa-token");
  });
});

describe("getValidAccessToken / disconnectWhatsApp", () => {
  beforeEach(() => {
    process.env.META_ENCRYPTION_KEY = KEY;
  });

  it("returns the decrypted token for a connected account", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    await expect(
      service.getValidAccessToken("org_1", repo.accounts[0]!.id as string),
    ).resolves.toBe("wa-token");
  });

  it("rejects foreign tenants and unknown accounts", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    await expect(
      service.getValidAccessToken("org_2", repo.accounts[0]!.id as string),
    ).rejects.toThrow(WhatsAppOAuthError);
    await expect(service.getValidAccessToken("org_1", "missing")).rejects.toThrow(
      WhatsAppOAuthError,
    );
  });

  it("disconnect destroys ciphertext and audits", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    expect(await service.disconnectWhatsApp("org_1", repo.accounts[0]!.id as string)).toBe(true);
    expect(repo.accounts[0]).toMatchObject({ status: "DISCONNECTED", encryptedAccessToken: null });
    expect(repo.audit.some((log) => log.action === "WHATSAPP_DISCONNECTED")).toBe(true);
    await expect(
      service.getValidAccessToken("org_1", repo.accounts[0]!.id as string),
    ).rejects.toThrow(/disconnected/i);
  });

  it("disconnect is false for foreign accounts", async () => {
    const { service, repo } = makeService();
    await service.connectWhatsApp("org_1");
    await service.exchangeToken({ code: "c1", state: "wa-state" });
    expect(await service.disconnectWhatsApp("org_2", repo.accounts[0]!.id as string)).toBe(false);
  });
});
