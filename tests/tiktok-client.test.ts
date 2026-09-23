import { describe, expect, it } from "vitest";
import { TikTokApiClient, signTikTokRequest } from "@/modules/connectors/tiktok/api/client";

const config = { appKey: "app-key", appSecret: "app-secret", apiBaseUrl: "https://example.test" };

describe("TikTok Shop API client", () => {
  it("uses the official deterministic path + sorted parameter signing input", () => {
    const left = signTikTokRequest(
      "/product/202502/products/search",
      { timestamp: 2, app_key: "app-key", shop_cipher: "cipher", access_token: "do-not-sign" },
      "{}",
      "app-secret",
    );
    const right = signTikTokRequest(
      "/product/202502/products/search",
      { shop_cipher: "cipher", app_key: "app-key", timestamp: 2 },
      "{}",
      "app-secret",
    );
    expect(left).toBe(right);
    expect(left).toMatch(/^[a-f0-9]{64}$/);
  });

  it("sets the access token only in the server request header and decodes data", async () => {
    let url = "";
    let headers: Headers | undefined;
    const client = new TikTokApiClient({
      ...config,
      fetch: async (input, init) => {
        url = String(input);
        headers = new Headers(init?.headers);
        return new Response(JSON.stringify({ code: 0, data: { products: [] } }), {
          headers: { "content-type": "application/json", "x-ratelimit-remaining": "99" },
        });
      },
    });
    await expect(
      client.request<{ products: unknown[] }>({
        path: "/product/202502/products/search",
        accessToken: "never-in-url",
        shopCipher: "shop-cipher",
        body: {},
      }),
    ).resolves.toEqual({ products: [] });
    expect(url).not.toContain("never-in-url");
    expect(headers?.get("x-tts-access-token")).toBe("never-in-url");
    expect(new URL(url).searchParams.get("sign")).toMatch(/^[a-f0-9]{64}$/);
    expect(client.getRateLimitSnapshot().remaining).toBe(99);
  });

  it("retries a rate-limited request using Retry-After", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const client = new TikTokApiClient({
      ...config,
      maxRetries: 2,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      fetch: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ code: 429, message: "limited" }), {
            status: 429,
            headers: { "retry-after": "1" },
          });
        }
        return new Response(JSON.stringify({ code: 0, data: { ok: true } }));
      },
    });
    await expect(
      client.request<{ ok: boolean }>({ path: "/x", accessToken: "a" }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleeps).toContain(1000);
  });

  it("does not retry permanent official API failures", async () => {
    const client = new TikTokApiClient({
      ...config,
      fetch: async () =>
        new Response(JSON.stringify({ code: 105005, message: "scope missing" }), { status: 400 }),
    });
    await expect(client.request({ path: "/x", accessToken: "a" })).rejects.toMatchObject({
      name: "TikTokApiError",
      status: 400,
      code: 105005,
    });
  });
});
