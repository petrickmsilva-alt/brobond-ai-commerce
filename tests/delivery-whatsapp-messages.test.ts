import { describe, expect, it, vi } from "vitest";
import {
  WhatsAppConnector,
  sendTemplate,
  sendText,
} from "@/modules/delivery/whatsapp/message.service";
import { DeliveryProviderError } from "@/modules/delivery/core/delivery.interface";
import type { WhatsAppClient } from "@/modules/delivery/whatsapp/client";
import type { DeliveryConnector } from "@/modules/delivery/core/delivery.interface";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeClient() {
  const sendMessage = vi.fn(async () => ({ providerMessageId: "wamid-1", waId: "5511999" }));
  const buildTextBody = vi.fn((text: string) => ({ type: "text", text: { body: text } }));
  const buildTemplateBody = vi.fn((input: Record<string, unknown>) => ({
    type: "template",
    template: input,
  }));
  const client = { sendMessage, buildTextBody, buildTemplateBody } as unknown as WhatsAppClient;
  return { client, sendMessage, buildTextBody, buildTemplateBody };
}

describe("sendText (WhatsApp Cloud API)", () => {
  it("sends via the official endpoint and returns the wamid", async () => {
    const { client, sendMessage, buildTextBody } = fakeClient();
    const result = await sendText(
      { accessToken: "t", phoneNumberId: "pnid-1", recipientId: "+5511999", text: "Olá" },
      { client },
    );
    expect(result.providerMessageId).toBe("wamid-1");
    expect(buildTextBody).toHaveBeenCalledWith("Olá");
    expect(sendMessage).toHaveBeenCalledWith({
      accessToken: "t",
      phoneNumberId: "pnid-1",
      recipientId: "+5511999",
      body: { type: "text", text: { body: "Olá" } },
    });
  });
});

describe("sendTemplate (WhatsApp Cloud API)", () => {
  it("sends a pre-approved template", async () => {
    const { client, sendMessage, buildTemplateBody } = fakeClient();
    const result = await sendTemplate(
      {
        accessToken: "t",
        phoneNumberId: "pnid-1",
        recipientId: "+5511999",
        templateName: "order_ready",
        language: "pt_BR",
      },
      { client },
    );
    expect(result.providerMessageId).toBe("wamid-1");
    expect(buildTemplateBody).toHaveBeenCalledWith({
      templateName: "order_ready",
      language: "pt_BR",
      components: undefined,
    });
    expect(sendMessage).toHaveBeenCalled();
  });

  it("forwards template components", async () => {
    const { client, buildTemplateBody } = fakeClient();
    const components = [
      { type: "body" as const, parameters: [{ type: "text" as const, text: "Ana" }] },
    ];
    await sendTemplate(
      {
        accessToken: "t",
        phoneNumberId: "pnid-1",
        recipientId: "+5511999",
        templateName: "t1",
        language: "en_US",
        components,
      },
      { client },
    );
    expect(buildTemplateBody).toHaveBeenCalledWith({
      templateName: "t1",
      language: "en_US",
      components,
    });
  });
});

describe("WhatsAppConnector (DeliveryConnector contract)", () => {
  it("has the WHATSAPP channel and fulfills the interface", () => {
    const connector: DeliveryConnector = new WhatsAppConnector({ client: fakeClient().client });
    expect(connector.channel).toBe("WHATSAPP");
    expect(typeof connector.sendMessage).toBe("function");
  });

  it("routes text messages to sendText", async () => {
    const { client, sendMessage, buildTextBody } = fakeClient();
    const connector = new WhatsAppConnector({ client });
    const result = await connector.sendMessage({
      account: { accountId: "pnid-1", accountName: "Brobond", accessToken: "plain" },
      recipientId: "+5511999",
      message: { type: "text", text: "Seu pedido chegou" },
    });
    expect(result.providerMessageId).toBe("wamid-1");
    expect(buildTextBody).toHaveBeenCalledWith("Seu pedido chegou");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "plain", phoneNumberId: "pnid-1" }),
    );
  });

  it("routes template messages to sendTemplate", async () => {
    const { client, buildTemplateBody } = fakeClient();
    const connector = new WhatsAppConnector({ client });
    await connector.sendMessage({
      account: { accountId: "pnid-1", accountName: null, accessToken: "plain" },
      recipientId: "+5511999",
      message: { type: "template", templateName: "welcome", language: "pt_BR" },
    });
    expect(buildTemplateBody).toHaveBeenCalledWith({
      templateName: "welcome",
      language: "pt_BR",
      components: undefined,
    });
  });

  it("propagates provider failures untransformed", async () => {
    const failure = new DeliveryProviderError("boom", { status: 500 });
    const client = {
      sendMessage: vi.fn(async () => {
        throw failure;
      }),
      buildTextBody: (text: string) => ({ type: "text", text: { body: text } }),
      buildTemplateBody: (input: unknown) => input,
    } as unknown as WhatsAppClient;
    const connector = new WhatsAppConnector({ client });
    await expect(
      connector.sendMessage({
        account: { accountId: "p", accountName: null, accessToken: "t" },
        recipientId: "u",
        message: { type: "text", text: "x" },
      }),
    ).rejects.toBe(failure);
  });
});
