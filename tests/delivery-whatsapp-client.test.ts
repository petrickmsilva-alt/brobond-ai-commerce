import { describe, expect, it, vi } from "vitest";
import {
  WHATSAPP_OAUTH_SCOPES,
  WhatsAppClient,
  createWhatsAppClient,
} from "@/modules/delivery/whatsapp/client";
import { DeliveryProviderError } from "@/modules/delivery/core/delivery.interface";

const CONFIG = {
  appId: "wa-app",
  appSecret: "wa-secret",
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

describe("WhatsApp client — configuration", () => {
  it("requests the contracted Cloud API scopes", () => {
    expect(WHATSAPP_OAUTH_SCOPES).toContain("whatsapp_business_messaging");
    expect(WHATSAPP_OAUTH_SCOPES).toContain("whatsapp_business_management");
  });

  it("createWhatsAppClient builds a client", () => {
    expect(createWhatsAppClient(CONFIG, { fetch: fakeFetch().fn })).toBeInstanceOf(WhatsAppClient);
  });
});

describe("WhatsApp client — Embedded Signup exchange", () => {
  it("exchangeToken calls the official oauth endpoint", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, { access_token: "wa-token", token_type: "bearer" }),
    );
    const client = createWhatsAppClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const token = await client.exchangeToken("code-9", "https://app/cb");
    expect(token.access_token).toBe("wa-token");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("wa-app");
    expect(url.searchParams.get("code")).toBe("code-9");
  });

  it("getPhoneNumberInfo verifies the sender identity", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, {
        id: "pnid-1",
        display_phone_number: "+55 11 99999-0000",
        verified_name: "Brobond",
        quality_rating: "GREEN",
      }),
    );
    const client = createWhatsAppClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const info = await client.getPhoneNumberInfo("pnid-1", "tok");
    expect(info.verified_name).toBe("Brobond");
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/pnid-1");
    expect(calls[0]!.init?.headers).toMatchObject({ authorization: "Bearer tok" });
  });
});

describe("WhatsApp client — message sends", () => {
  it("sendMessage returns the provider wamid", async () => {
    const { fn, calls } = fakeFetch(
      jsonResponse(200, {
        messaging_product: "whatsapp",
        contacts: [{ input: "5511999990000", wa_id: "5511999990000" }],
        messages: [{ id: "wamid.HBg=" }],
      }),
    );
    const client = createWhatsAppClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const result = await client.sendMessage({
      accessToken: "t",
      phoneNumberId: "pnid-1",
      recipientId: "+5511999990000",
      body: { type: "text", text: { body: "oi", preview_url: false } },
    });
    expect(result).toEqual({ providerMessageId: "wamid.HBg=", waId: "5511999990000" });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v21.0/pnid-1/messages");
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5511999990000",
      type: "text",
    });
  });

  it("throws a retryable provider error when no wamid is returned", async () => {
    const { fn } = fakeFetch(jsonResponse(200, { messaging_product: "whatsapp", messages: [] }));
    const client = createWhatsAppClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const error = await client
      .sendMessage({ accessToken: "t", phoneNumberId: "p", recipientId: "u", body: {} })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect((error as DeliveryProviderError).retryable).toBe(true);
  });

  it("buildTextBody shapes the official text payload", () => {
    const client = createWhatsAppClient(CONFIG, { fetch: fakeFetch().fn });
    expect(client.buildTextBody("Olá")).toEqual({
      type: "text",
      text: { body: "Olá", preview_url: false },
    });
  });

  it("buildTemplateBody shapes the official template payload", () => {
    const client = createWhatsAppClient(CONFIG, { fetch: fakeFetch().fn });
    expect(client.buildTemplateBody({ templateName: "order_ready", language: "pt_BR" })).toEqual({
      type: "template",
      template: { name: "order_ready", language: { code: "pt_BR" } },
    });
  });

  it("buildTemplateBody includes components when provided", () => {
    const client = createWhatsAppClient(CONFIG, { fetch: fakeFetch().fn });
    const body = client.buildTemplateBody({
      templateName: "t1",
      language: "en_US",
      components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
    });
    expect(body).toMatchObject({
      type: "template",
      template: {
        name: "t1",
        language: { code: "en_US" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }],
      },
    });
  });

  it("surfaces Graph errors as DeliveryProviderError with code", async () => {
    const { fn } = fakeFetch(
      jsonResponse(400, { error: { message: "template not found", code: 132_012 } }),
    );
    const client = createWhatsAppClient(CONFIG, { fetch: fn, sleep: async () => {} });
    const error = await client
      .sendMessage({ accessToken: "t", phoneNumberId: "p", recipientId: "u", body: {} })
      .catch((caught: unknown) => caught);
    expect((error as DeliveryProviderError).code).toBe(132_012);
    expect((error as DeliveryProviderError).retryable).toBe(false);
  });
});
