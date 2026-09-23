import { describe, expect, it, vi } from "vitest";
import {
  INSTAGRAM_OAUTH_SCOPES,
  InstagramClient,
  createInstagramClient,
} from "@/modules/delivery/instagram/client";
import { DeliveryProviderError } from "@/modules/delivery/core/delivery.interface";

const CONFIG = {
  appId: "ig-app",
  appSecret: "ig-secret",
  apiBaseUrl: "https://graph.facebook.com",
  apiVersion: "v21.0",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function fakeFetch(...responses: Response[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("Instagram client — OAuth endpoints", () => {
  it("requests the contracted messaging scopes", () => {
    expect(INSTAGRAM_OAUTH_SCOPES).toContain("instagram_business_basic");
    expect(INSTAGRAM_OAUTH_SCOPES).toContain("instagram_business_manage_messages");
    expect(INSTAGRAM_OAUTH_SCOPES.join(",")).not.toContain(" ");
  });

  it("exchangeCode posts credentials as a query (official endpoint)", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, { access_token: "short", token_type: "bearer", expires_in: 3600 }),
    );
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const token = await client.exchangeCode("code-1", "https://app/cb");
    expect(token.access_token).toBe("short");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("ig-app");
    expect(url.searchParams.get("client_secret")).toBe("ig-secret");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app/cb");
    expect(url.searchParams.get("code")).toBe("code-1");
  });

  it("exchangeForLongLivedToken uses fb_exchange_token grant", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, { access_token: "long", expires_in: 5_184_000 }),
    );
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const token = await client.exchangeForLongLivedToken("short-token");
    expect(token.access_token).toBe("long");
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("grant_type")).toBe("fb_exchange_token");
    expect(url.searchParams.get("fb_exchange_token")).toBe("short-token");
  });

  it("refreshLongLivedToken re-exchanges the current token", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, { access_token: "rotated", expires_in: 5_184_000 }),
    );
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    await client.refreshLongLivedToken("current-long");
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("fb_exchange_token")).toBe("current-long");
  });
});

describe("Instagram client — account discovery", () => {
  it("maps pages with linked Instagram Business accounts", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, {
        data: [
          {
            id: "p1",
            name: "Page One",
            instagram_business_account: { id: "ig-1", username: "shop" },
          },
          { id: "p2", name: "Page Two" },
          { id: "p3", instagram_business_account: { id: "ig-3" } },
        ],
      }),
    );
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const accounts = await client.listBusinessAccounts("user-token");
    expect(accounts).toEqual([
      { id: "ig-1", username: "shop", name: "Page One" },
      { id: "ig-3", username: undefined, name: undefined },
    ]);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/me/accounts");
    expect(calls[0]!.init?.headers).toMatchObject({ authorization: "Bearer user-token" });
  });

  it("returns an empty list when no page has an IG business account", async () => {
    const { fn } = fakeFetch(jsonResponse(200, { data: [{ id: "p1" }] }));
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    await expect(client.listBusinessAccounts("t")).resolves.toEqual([]);
  });
});

describe("Instagram client — Direct Messages", () => {
  it("sends a DM through the official messages endpoint", async () => {
    const { fn, calls } = fakeFetch(jsonResponse(200, { recipient_id: "u9", message_id: "mid-1" }));
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const response = await client.sendDirectMessage({
      accessToken: "page-token",
      instagramAccountId: "ig-1",
      recipientId: "u9",
      text: "Olá, tudo bem?",
    });
    expect(response.message_id).toBe("mid-1");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/ig-1/messages");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      recipient: { id: "u9" },
      messaging_type: "RESPONSE",
      message: { text: "Olá, tudo bem?" },
    });
  });

  it("escapes unusual account ids in the path", async () => {
    const { fn, calls } = fakeFetch(jsonResponse(200, { message_id: "m" }));
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    await client.sendDirectMessage({
      accessToken: "t",
      instagramAccountId: "ig account/slash",
      recipientId: "u",
      text: "x",
    });
    expect(new URL(calls[0]!.url).pathname).toBe("/v21.0/ig%20account%2Fslash/messages");
  });

  it("surfaces provider errors as DeliveryProviderError", async () => {
    const { fn } = fakeFetch(
      jsonResponse(400, { error: { message: "(#100) recipient invalid", code: 100 } }),
    );
    const client = createInstagramClient(CONFIG, { fetch: fn, sleep: async () => {} });
    await expect(
      client.sendDirectMessage({
        accessToken: "t",
        instagramAccountId: "ig-1",
        recipientId: "bad",
        text: "x",
      }),
    ).rejects.toThrow(DeliveryProviderError);
  });
});
