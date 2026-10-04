import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.hoisted(() => vi.fn());
const startOAuthMock = vi.hoisted(() => vi.fn());
const plantOAuthStateCookieMock = vi.hoisted(() => vi.fn());

vi.mock("@prisma/client", () => ({
  UserRole: { ADMIN: "ADMIN", MANAGER: "MANAGER", MEMBER: "MEMBER" },
}));
vi.mock("@/lib/session", () => ({ requireAdmin: requireAdminMock }));
vi.mock("@/lib/oauth-state-cookie", () => ({
  plantOAuthStateCookie: plantOAuthStateCookieMock,
}));
vi.mock("@/modules/marketplace/core/connector.service", () => ({
  marketplaceService: { startOAuth: startOAuthMock },
}));
vi.mock("@/modules/connectors/tiktok/auth/oauth.service", () => ({
  revokeConnection: vi.fn(),
}));
vi.mock("@/modules/connectors/tiktok/sync/importer", () => ({
  tiktokImporter: { sync: vi.fn() },
}));
vi.mock("@/modules/connectors/tiktok/pending-approval.service", () => ({
  TikTokPendingApprovalError: class TikTokPendingApprovalError extends Error {},
}));

const { TikTokLoginConfigError } =
  await import("@/modules/connectors/tiktok/auth/login-kit.config");
const { connectTikTokAction } = await import("@/app/dashboard/tiktok/actions");

const ADMIN = {
  id: "user-admin",
  email: "admin@brobond.ai",
  name: "Admin",
  image: null,
  role: "ADMIN",
  organizationId: "org-1",
};

describe("connectTikTokAction() — typed Login Kit failures", () => {
  beforeEach(() => {
    requireAdminMock.mockReset().mockResolvedValue(ADMIN);
    startOAuthMock.mockReset();
    plantOAuthStateCookieMock.mockReset().mockResolvedValue(undefined);
  });

  it("returns a typed callback-alignment response instead of rejecting", async () => {
    startOAuthMock.mockRejectedValue(
      new TikTokLoginConfigError(
        "REDIRECT_URI_MISMATCH",
        "configured host contains internal deployment details",
      ),
    );

    await expect(connectTikTokAction()).resolves.toEqual({
      ok: false,
      code: "CALLBACK_MISALIGNED",
      error:
        "A URL de retorno do TikTok está desalinhada. TIKTOK_REDIRECT_URI deve ser APP_URL + /api/connectors/tiktok/callback, sem barra final.",
    });
    expect(plantOAuthStateCookieMock).not.toHaveBeenCalled();
  });

  it("distinguishes missing Login Kit credentials from callback alignment", async () => {
    startOAuthMock.mockRejectedValue(
      new TikTokLoginConfigError("MISSING_CREDENTIALS", "TIKTOK_CLIENT_SECRET is missing"),
    );

    const result = await connectTikTokAction();
    expect(result).toMatchObject({
      ok: false,
      code: "LOGIN_KIT_NOT_CONFIGURED",
    });
    expect(JSON.stringify(result)).not.toContain("TIKTOK_CLIENT_SECRET is missing");
  });

  it("keeps unknown execution failures inside the serializable result union", async () => {
    startOAuthMock.mockRejectedValue(new Error("database internals"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(connectTikTokAction()).resolves.toEqual({
      ok: false,
      code: "UNEXPECTED",
      error: "Não foi possível concluir a operação com TikTok.",
    });

    consoleError.mockRestore();
  });

  it("returns only the Login Kit v2 authorization URL and plants its state cookie", async () => {
    const stateCookie = {
      name: "brobond_tiktok_oauth_state",
      value: "opaque-state",
      maxAge: 600,
    };
    startOAuthMock.mockResolvedValue({
      authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/?state=opaque-state",
      stateCookie,
    });

    await expect(connectTikTokAction()).resolves.toEqual({
      ok: true,
      data: {
        authorizationUrl: "https://www.tiktok.com/v2/auth/authorize/?state=opaque-state",
      },
    });
    expect(startOAuthMock).toHaveBeenCalledWith("org-1", "TIKTOK");
    expect(plantOAuthStateCookieMock).toHaveBeenCalledWith(stateCookie);
  });
});
