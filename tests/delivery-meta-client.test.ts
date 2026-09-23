import { describe, expect, it, vi } from "vitest";
import {
  META_GRAPH_API_BASE_URL,
  META_GRAPH_DEFAULT_VERSION,
  META_OAUTH_AUTHORIZE_BASE_URL,
  MetaGraphClient,
  buildAppAccessToken,
  getMetaApiConfig,
  metaAuthorizeUrl,
  metaGraphUrl,
} from "@/modules/delivery/core/meta-client";
import {
  DeliveryConfigurationError,
  DeliveryProviderError,
} from "@/modules/delivery/core/delivery.interface";

const CONFIG = {
  appId: "app-123",
  appSecret: "secret-xyz",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v21.0",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchReturning(...responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected extra fetch");
    return next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

describe("Meta Graph client — configuration", () => {
  it("defaults to the official graph base and version", () => {
    expect(META_GRAPH_API_BASE_URL).toBe("https://graph.facebook.com");
    expect(META_GRAPH_DEFAULT_VERSION).toBe("v21.0");
    expect(META_OAUTH_AUTHORIZE_BASE_URL).toBe("https://www.facebook.com");
  });

  it("builds versioned graph urls", () => {
    expect(metaGraphUrl(CONFIG)).toBe("https://graph.facebook.com/v21.0");
    expect(metaGraphUrl({ ...CONFIG, apiBaseUrl: "https://edge.example.com/" })).toBe(
      "https://edge.example.com/v21.0",
    );
  });

  it("builds the Facebook Login dialog url", () => {
    expect(metaAuthorizeUrl()).toBe("https://www.facebook.com/v21.0/dialog/oauth");
  });

  it("reads config lazily from the environment", () => {
    const originalId = process.env.META_APP_ID;
    const originalSecret = process.env.META_APP_SECRET;
    process.env.META_APP_ID = "  app-env  ";
    process.env.META_APP_SECRET = "secret-env";
    try {
      const config = getMetaApiConfig();
      expect(config.appId).toBe("app-env");
      expect(config.appSecret).toBe("secret-env");
    } finally {
      if (originalId === undefined) delete process.env.META_APP_ID;
      else process.env.META_APP_ID = originalId;
      if (originalSecret === undefined) delete process.env.META_APP_SECRET;
      else process.env.META_APP_SECRET = originalSecret;
    }
  });

  it("fails fast when required env is missing", () => {
    const originalId = process.env.META_APP_ID;
    delete process.env.META_APP_ID;
    try {
      expect(() => getMetaApiConfig()).toThrow(DeliveryConfigurationError);
      expect(() => getMetaApiConfig()).toThrow(/META_APP_ID is required/);
    } finally {
      if (originalId !== undefined) process.env.META_APP_ID = originalId;
    }
  });

  it("buildAppAccessToken is the standard appid|secret pair", () => {
    expect(buildAppAccessToken(CONFIG)).toBe("app-123|secret-xyz");
  });
});

describe("Meta Graph client — requests", () => {
  it("issues GET with bearer token and query params", async () => {
    const { fn, calls } = fetchReturning(jsonResponse(200, { ok: true }));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    const result = await client.request<{ ok: boolean }>({
      path: "/me",
      accessToken: "token-1",
      query: { fields: "id,name", limit: 10, flag: true, skip: undefined },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.origin + url.pathname).toBe("https://graph.facebook.com/v21.0/me");
    expect(url.searchParams.get("fields")).toBe("id,name");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(url.searchParams.get("flag")).toBe("true");
    expect(url.searchParams.has("skip")).toBe(false);
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer token-1");
    expect(headers["content-type"]).toBeUndefined();
  });

  it("issues POST with a JSON body", async () => {
    const { fn, calls } = fetchReturning(jsonResponse(200, { message_id: "m1" }));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    await client.request({
      method: "POST",
      path: "/123/messages",
      accessToken: "t",
      body: { recipient: { id: "u1" }, message: { text: "hi" } },
    });
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.body).toBe(
      JSON.stringify({ recipient: { id: "u1" }, message: { text: "hi" } }),
    );
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
  });

  it("omits the authorization header when no token is given", async () => {
    const { fn, calls } = fetchReturning(jsonResponse(200, {}));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    await client.request({ path: "/oauth/access_token" });
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("maps Graph error envelopes to DeliveryProviderError with code", async () => {
    const { fn } = fetchReturning(
      jsonResponse(400, {
        error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 },
      }),
    );
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    const error = await client.request({ path: "/me" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect((error as DeliveryProviderError).status).toBe(400);
    expect((error as DeliveryProviderError).code).toBe(190);
    expect((error as DeliveryProviderError).message).toContain("Invalid OAuth access token.");
    expect((error as DeliveryProviderError).retryable).toBe(false);
  });

  it("does NOT retry permanent 4xx failures", async () => {
    const { fn, calls } = fetchReturning(
      jsonResponse(403, { error: { message: "forbidden", code: 200 } }),
    );
    const sleep = vi.fn(noSleep);
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep });
    await expect(client.request({ path: "/me" })).rejects.toThrow(DeliveryProviderError);
    expect(calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries 429 with exponential backoff and eventually succeeds", async () => {
    const { fn, calls } = fetchReturning(
      jsonResponse(429, { error: { message: "rate limit", code: 4 } }),
      jsonResponse(429, { error: { message: "rate limit", code: 4 } }),
      jsonResponse(200, { ok: true }),
    );
    const sleeps: number[] = [];
    const client = new MetaGraphClient(CONFIG, {
      fetch: fn,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      maxRetries: 3,
    });
    const result = await client.request<{ ok: boolean }>({ path: "/me" });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("retries 5xx then throws the last error when retries run out", async () => {
    const { fn, calls } = fetchReturning(
      jsonResponse(500, { error: { message: "boom-1" } }),
      jsonResponse(502, { error: { message: "boom-2" } }),
    );
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep, maxRetries: 1 });
    const error = await client.request({ path: "/me" }).catch((caught: unknown) => caught);
    expect((error as DeliveryProviderError).status).toBe(502);
    expect((error as DeliveryProviderError).message).toContain("boom-2");
    expect(calls).toHaveLength(2);
  });

  it("treats network failures as retryable", async () => {
    const fn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new MetaGraphClient(CONFIG, {
      fetch: fn as unknown as typeof fetch,
      sleep: noSleep,
      maxRetries: 1,
    });
    const error = await client.request({ path: "/me" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect((error as DeliveryProviderError).status).toBe(0);
    expect((error as DeliveryProviderError).message).toContain(
      "Unable to reach the Meta Graph API",
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("redacts access tokens from provider error messages", async () => {
    const { fn } = fetchReturning(
      jsonResponse(400, { error: { message: "Bad token access_token=EAABxyz123 in query" } }),
    );
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    const error = await client.request({ path: "/me" }).catch((caught: unknown) => caught);
    expect((error as DeliveryProviderError).message).not.toContain("EAABxyz123");
    expect((error as DeliveryProviderError).message).toContain("access_token=[redacted]");
  });

  it("rejects empty-base urls deterministically", async () => {
    const { fn, calls } = fetchReturning(jsonResponse(200, {}));
    const client = new MetaGraphClient(
      { ...CONFIG, apiBaseUrl: "https://g.example.com/" },
      {
        fetch: fn,
        sleep: noSleep,
      },
    );
    await client.request({ path: "/x" });
    expect(calls[0]!.url.startsWith("https://g.example.com/v21.0/x")).toBe(true);
  });

  it("handles empty 200 bodies", async () => {
    const { fn } = fetchReturning(new Response("", { status: 200 }));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    await expect(client.request({ path: "/x" })).resolves.toEqual({});
  });

  it("invalid JSON on success path is a provider error", async () => {
    const { fn } = fetchReturning(new Response("not-json", { status: 200 }));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep });
    await expect(client.request({ path: "/x" })).rejects.toThrow(/invalid response/i);
  });

  it("falls back to a generic message when the envelope has none", async () => {
    const { fn } = fetchReturning(jsonResponse(503, {}));
    const client = new MetaGraphClient(CONFIG, { fetch: fn, sleep: noSleep, maxRetries: 0 });
    const error = await client.request({ path: "/x" }).catch((caught: unknown) => caught);
    expect((error as DeliveryProviderError).message).toContain("503");
  });
});
