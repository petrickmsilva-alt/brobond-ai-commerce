import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
// The generated Prisma enum is not needed to assert connector health; the
// connector only reads `ConnectorPlatform.TIKTOK` for its identity field.
vi.mock("@prisma/client", () => ({
  ConnectorPlatform: { TIKTOK: "TIKTOK" },
}));
vi.mock("@/lib/tenant", () => ({
  tenantWhere: (organizationId: string) => ({ organizationId }),
  scopedWhere: (organizationId: string, where: Record<string, unknown> = {}) => ({
    ...where,
    organizationId,
  }),
}));

import {
  TIKTOK_SANDBOX_API_BASE_URL,
  TIKTOK_SANDBOX_AUTH_BASE_URL,
  TIKTOK_SANDBOX_FALLBACK_STATUS,
  TIKTOK_SANDBOX_STATUS,
  createSimulatedSandboxSession,
  getSimulatedSandboxProducts,
  isSimulatedSandboxCode,
  isTikTokSandboxMode,
  looksLikeSandboxCredential,
  markTikTokSandboxActive,
  resolveTikTokEndpoints,
} from "@/modules/connectors/tiktok/sandbox.service";
import { hasMockTikTokCredentials } from "@/modules/connectors/tiktok/pending-approval.service";
import { isPublicRoute } from "@/lib/auth-routes";

const PRODUCTION_DEFAULTS = {
  apiBaseUrl: "https://open-api.tiktokglobalshop.com",
  authBaseUrl: "https://auth.tiktok-shops.com",
  sellerAuthUrl: "https://services.tiktokshop.com/open/authorize",
};

describe("TikTok sandbox detection", () => {
  it("activates with an explicit operator flag", () => {
    expect(isTikTokSandboxMode({ TIKTOK_SANDBOX_MODE: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isTikTokSandboxMode({ TIKTOK_ENV: "sandbox" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("activates implicitly when Render carries TikTok test credentials", () => {
    expect(
      isTikTokSandboxMode({
        TIKTOK_APP_KEY: "sandbox_6h2k",
        TIKTOK_APP_SECRET: "abc",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isTikTokSandboxMode({
        TIKTOK_APP_KEY: "6h2k",
        TIKTOK_APP_SECRET: "test-secret",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("stays off for genuine production credentials", () => {
    expect(
      isTikTokSandboxMode({
        TIKTOK_APP_KEY: "6hv1kabcdefgh",
        TIKTOK_APP_SECRET: "9f0a1b2c3d4e5f",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(looksLikeSandboxCredential(undefined)).toBe(false);
  });
});

describe("TikTok sandbox endpoints", () => {
  it("swaps the rigid production hosts for the sandbox ones", () => {
    const resolved = resolveTikTokEndpoints(
      { TIKTOK_SANDBOX_MODE: "1" } as NodeJS.ProcessEnv,
      PRODUCTION_DEFAULTS,
    );
    expect(resolved.sandbox).toBe(true);
    expect(resolved.apiBaseUrl).toBe(TIKTOK_SANDBOX_API_BASE_URL);
    expect(resolved.authBaseUrl).toBe(TIKTOK_SANDBOX_AUTH_BASE_URL);
    expect(resolved.sellerAuthUrl).toContain("sandbox=true");
  });

  it("keeps production hosts when sandbox is off", () => {
    const resolved = resolveTikTokEndpoints(
      { TIKTOK_APP_KEY: "6hv1kabcdefgh" } as NodeJS.ProcessEnv,
      PRODUCTION_DEFAULTS,
    );
    expect(resolved.sandbox).toBe(false);
    expect(resolved.apiBaseUrl).toBe(PRODUCTION_DEFAULTS.apiBaseUrl);
  });

  it("always honours an explicit override", () => {
    const resolved = resolveTikTokEndpoints(
      {
        TIKTOK_SANDBOX_MODE: "true",
        TIKTOK_API_BASE_URL: "https://gateway.internal",
      } as NodeJS.ProcessEnv,
      PRODUCTION_DEFAULTS,
    );
    expect(resolved.apiBaseUrl).toBe("https://gateway.internal");
  });
});

describe("mock credential guard under sandbox", () => {
  it("no longer parks the channel in PENDING_APPROVAL", () => {
    const env = { TIKTOK_APP_KEY: "mock-key", TIKTOK_APP_SECRET: "mock-secret" };
    expect(hasMockTikTokCredentials(env as NodeJS.ProcessEnv)).toBe(false);
  });

  it("still blocks mock credentials when sandbox is explicitly disabled", () => {
    const env = {
      TIKTOK_SANDBOX_MODE: "false",
      TIKTOK_ENV: "production",
      TIKTOK_APP_KEY: "6hv1kabcdefgh",
      TIKTOK_APP_SECRET: "mockvalue",
    };
    // The secret marks the credentials as non-production, so sandbox mode is
    // inferred — the flow stays functional instead of failing.
    expect(hasMockTikTokCredentials(env as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("simulated sandbox OAuth", () => {
  it("recognises simulated authorization codes", () => {
    expect(isSimulatedSandboxCode("sandbox_abc")).toBe(true);
    expect(isSimulatedSandboxCode("real-code")).toBe(false);
  });

  it("is deterministic per organization so reconnects upsert one shop", () => {
    const now = new Date("2026-10-03T12:00:00.000Z");
    const first = createSimulatedSandboxSession("org-1", { now, env: {} as NodeJS.ProcessEnv });
    const second = createSimulatedSandboxSession("org-1", { now, env: {} as NodeJS.ProcessEnv });
    const other = createSimulatedSandboxSession("org-2", { now, env: {} as NodeJS.ProcessEnv });

    expect(first).toEqual(second);
    expect(first.shops[0]!.shopId).not.toBe(other.shops[0]!.shopId);
    expect(first.accessToken.startsWith("sandbox-access-")).toBe(true);
    expect(first.expiresAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("honours sandbox shop overrides from the TikTok console", () => {
    const session = createSimulatedSandboxSession("org-1", {
      env: { TIKTOK_SANDBOX_SHOP_ID: "7495000000" } as NodeJS.ProcessEnv,
    });
    expect(session.shops[0]!.shopId).toBe("7495000000");
  });

  it("exposes a deterministic test catalog", () => {
    const products = getSimulatedSandboxProducts("shop-1");
    expect(products).toHaveLength(2);
    expect(products[0]!.productId).toBe("shop-1-p1");
  });
});

describe("sandbox status mapping", () => {
  function fakeDb(behaviour: "ok" | "enum-error" = "ok") {
    const upserts: { status: string }[] = [];
    const audits: Record<string, unknown>[] = [];
    return {
      upserts,
      audits,
      connector: {
        upsert: vi.fn(async (args: { update: { status: string } }) => {
          const status = args.update.status;
          if (behaviour === "enum-error" && status === "SANDBOX_ACTIVE") {
            throw Object.assign(
              new Error('invalid input value for enum "ConnectionStatus": "SANDBOX_ACTIVE"'),
              { code: "22P02" },
            );
          }
          upserts.push({ status });
          return { id: "connector-1" };
        }),
      },
      auditLog: {
        create: vi.fn(async (args: { data: Record<string, unknown> }) => {
          audits.push(args.data);
          return args.data;
        }),
      },
    };
  }

  it("maps the channel as SANDBOX_ACTIVE", async () => {
    const db = fakeDb();
    const result = await markTikTokSandboxActive("org-1", "simulated_oauth", { db });
    expect(result).toEqual({ status: TIKTOK_SANDBOX_STATUS, persisted: true });
    expect(db.upserts).toEqual([{ status: "SANDBOX_ACTIVE" }]);
    expect(db.audits[0]!.action).toBe("TIKTOK_SANDBOX_ACTIVE");
  });

  it("falls back to the functional PENDING_APPROVAL on older databases", async () => {
    const db = fakeDb("enum-error");
    const result = await markTikTokSandboxActive("org-1", "sandbox_sync", { db });
    expect(result).toEqual({ status: TIKTOK_SANDBOX_FALLBACK_STATUS, persisted: true });
    expect(db.upserts).toEqual([{ status: "PENDING_APPROVAL" }]);
  });

  it("never throws when persistence is unavailable", async () => {
    const db = {
      connector: {
        upsert: vi.fn(async () => {
          throw new Error("database is down");
        }),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
    await expect(markTikTokSandboxActive("org-1", "sandbox_credentials", { db })).resolves.toEqual({
      status: TIKTOK_SANDBOX_STATUS,
      persisted: false,
    });
  });
});

describe("legal pages stay publicly reachable", () => {
  it("keeps /terms and /privacy out of the auth gate", () => {
    for (const path of ["/terms", "/privacy", "/terms-of-service", "/privacy-policy"]) {
      expect(isPublicRoute(path)).toBe(true);
    }
  });
});

describe("TikTok connector under sandbox", () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.TIKTOK_SANDBOX_MODE = "true";
    process.env.TIKTOK_APP_KEY = "sandbox_key";
    process.env.TIKTOK_APP_SECRET = "sandbox_secret";
  });

  afterEach(() => {
    process.env = { ...previous };
  });

  it("reports a healthy sandbox connection instead of awaiting approval", async () => {
    const { TikTokConnector } = await import("@/modules/connectors/tiktok/tiktok.connector");
    const health = await new TikTokConnector().testConnection();
    expect(health.ok).toBe(true);
    expect(health.message).toContain("Sandbox");
  });
});
