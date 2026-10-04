import { describe, expect, it } from "vitest";
import {
  TIKTOK_LOGIN_AUTHORIZE_URL,
  TIKTOK_LOGIN_DEFAULT_REDIRECT_URI,
  TIKTOK_LOGIN_SCOPE,
  TIKTOK_LOGIN_TOKEN_URL,
  TikTokLoginConfigError,
  getTikTokLoginConfig,
} from "@/modules/connectors/tiktok/auth/login-kit.config";
import {
  buildTikTokAuthorizationUrl,
  createTikTokLoginState,
  exchangeTikTokCode,
  isMatchingState,
  TikTokLoginError,
} from "@/modules/connectors/tiktok/auth/login-kit.service";
import { tiktokLoginCallbackSchema } from "@/modules/connectors/tiktok/validators";

const SANDBOX_ENV = {
  TIKTOK_CLIENT_KEY: "sbawkey123",
  TIKTOK_CLIENT_SECRET: "sbawsecret456",
  TIKTOK_REDIRECT_URI: TIKTOK_LOGIN_DEFAULT_REDIRECT_URI,
} as unknown as NodeJS.ProcessEnv;

describe("tiktok login kit — configuration", () => {
  it("reads the sandbox values and applies v2 defaults", () => {
    const config = getTikTokLoginConfig(SANDBOX_ENV);
    expect(config.clientKey).toBe("sbawkey123");
    expect(config.scope).toBe(TIKTOK_LOGIN_SCOPE);
    expect(config.redirectUri).toBe("http://localhost:3000/api/connectors/tiktok/callback");
    expect(config.authorizeUrl).toBe(TIKTOK_LOGIN_AUTHORIZE_URL);
    expect(config.tokenUrl).toBe(TIKTOK_LOGIN_TOKEN_URL);
  });

  it("refuses to run without a client key", () => {
    expect(() => getTikTokLoginConfig({} as unknown as NodeJS.ProcessEnv)).toThrow(
      TikTokLoginConfigError,
    );
  });
});

describe("tiktok login kit — authorization url", () => {
  const config = getTikTokLoginConfig(SANDBOX_ENV);

  it("builds the exact sandbox query contract with an encoded redirect", () => {
    const state = createTikTokLoginState();
    const raw = buildTikTokAuthorizationUrl(state, { config });
    const url = new URL(raw);

    expect(url.hostname.endsWith("tiktok.com")).toBe(true);
    expect(url.searchParams.get("client_key")).toBe("sbawkey123");
    expect(url.searchParams.get("scope")).toBe("user.info.stats");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe(state);
    expect(raw).toContain(
      "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fconnectors%2Ftiktok%2Fcallback",
    );
  });

  it("issues unique, high-entropy states and compares them safely", () => {
    const a = createTikTokLoginState();
    const b = createTikTokLoginState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(42);
    expect(isMatchingState(a, a)).toBe(true);
    expect(isMatchingState(a, b)).toBe(false);
    expect(isMatchingState(a, "")).toBe(false);
    expect(tiktokLoginCallbackSchema.safeParse({ code: "c", state: a }).success).toBe(true);
    expect(tiktokLoginCallbackSchema.safeParse({ code: "", state: a }).success).toBe(false);
  });
});

describe("tiktok login kit — code exchange", () => {
  const config = getTikTokLoginConfig(SANDBOX_ENV);
  const now = () => new Date("2026-10-03T12:00:00.000Z");

  it("POSTs form-urlencoded credentials and normalizes the token set", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const tokens = await exchangeTikTokCode("auth-code-1", {
      config,
      now,
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url: String(url), init };
        return new Response(
          JSON.stringify({
            access_token: "act.sandbox",
            refresh_token: "rft.sandbox",
            open_id: "open-id-123",
            scope: "user.info.stats",
            token_type: "Bearer",
            expires_in: 86400,
            refresh_expires_in: 31536000,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof fetch,
    });

    const call = seen as unknown as { url: string; init: RequestInit };
    expect(call.url).toBe(TIKTOK_LOGIN_TOKEN_URL);
    expect(call.init.method).toBe("POST");
    expect((call.init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(String(call.init.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_key")).toBe("sbawkey123");
    expect(body.get("client_secret")).toBe("sbawsecret456");
    expect(body.get("code")).toBe("auth-code-1");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);

    expect(tokens.openId).toBe("open-id-123");
    expect(tokens.accessToken).toBe("act.sandbox");
    expect(tokens.expiresAt.toISOString()).toBe("2026-10-04T12:00:00.000Z");
    expect(tokens.refreshExpiresAt).not.toBeNull();
  });

  it("surfaces a typed error when TikTok rejects the code", async () => {
    await expect(
      exchangeTikTokCode("bad", {
        config,
        now,
        fetch: (async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          })) as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(TikTokLoginError);
  });

  it("rejects a response without open_id", async () => {
    await expect(
      exchangeTikTokCode("x", {
        config,
        now,
        fetch: (async () =>
          new Response(JSON.stringify({ access_token: "a", expires_in: 100 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/open_id/);
  });
});
