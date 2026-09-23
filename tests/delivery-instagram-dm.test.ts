import { describe, expect, it, vi } from "vitest";
import { InstagramConnector, sendDirectMessage } from "@/modules/delivery/instagram/dm.service";
import {
  DeliveryProviderError,
  DeliveryStateError,
} from "@/modules/delivery/core/delivery.interface";
import type { InstagramClient } from "@/modules/delivery/instagram/client";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

function fakeClient(response: { message_id?: string; recipient_id?: string } | Error) {
  const sendDirectMessageMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    client: { sendDirectMessage: sendDirectMessageMock } as unknown as InstagramClient,
    sendDirectMessageMock,
  };
}

describe("sendDirectMessage (Instagram Messaging API)", () => {
  it("returns the provider message id", async () => {
    const { client, sendDirectMessageMock } = fakeClient({
      message_id: "mid-1",
      recipient_id: "u1",
    });
    const result = await sendDirectMessage(
      { accessToken: "t", instagramAccountId: "ig-1", recipientId: "u1", text: "Oi" },
      { client },
    );
    expect(result).toEqual({ providerMessageId: "mid-1", recipientId: "u1" });
    expect(sendDirectMessageMock).toHaveBeenCalledWith({
      accessToken: "t",
      instagramAccountId: "ig-1",
      recipientId: "u1",
      text: "Oi",
    });
  });

  it("throws a retryable provider error when Meta returns no message id", async () => {
    const { client } = fakeClient({ recipient_id: "u1" });
    const error = await sendDirectMessage(
      { accessToken: "t", instagramAccountId: "ig-1", recipientId: "u1", text: "Oi" },
      { client },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DeliveryProviderError);
    expect((error as DeliveryProviderError).retryable).toBe(true);
  });

  it("propagates the client error untouched", async () => {
    const failure = new DeliveryProviderError("rate limit", { status: 429 });
    const { client } = fakeClient(failure);
    await expect(
      sendDirectMessage(
        { accessToken: "t", instagramAccountId: "ig-1", recipientId: "u1", text: "Oi" },
        { client },
      ),
    ).rejects.toBe(failure);
  });
});

describe("InstagramConnector (DeliveryConnector contract)", () => {
  it("has the INSTAGRAM channel", () => {
    expect(new InstagramConnector({ client: fakeClient({ message_id: "m" }).client }).channel).toBe(
      "INSTAGRAM",
    );
  });

  it("sends text messages through the official client", async () => {
    const { client, sendDirectMessageMock } = fakeClient({ message_id: "mid-9" });
    const connector = new InstagramConnector({ client });
    const result = await connector.sendMessage({
      account: { accountId: "ig-1", accountName: "@brobond", accessToken: "plain-token" },
      recipientId: "u2",
      message: { type: "text", text: "Bem-vinda!" },
    });
    expect(result).toEqual({ providerMessageId: "mid-9" });
    expect(sendDirectMessageMock).toHaveBeenCalledWith({
      accessToken: "plain-token",
      instagramAccountId: "ig-1",
      recipientId: "u2",
      text: "Bem-vinda!",
    });
  });

  it("rejects template messages deterministically (WhatsApp-only feature)", async () => {
    const { client, sendDirectMessageMock } = fakeClient({ message_id: "x" });
    const connector = new InstagramConnector({ client });
    await expect(
      connector.sendMessage({
        account: { accountId: "ig-1", accountName: null, accessToken: "t" },
        recipientId: "u2",
        message: { type: "template", templateName: "welcome", language: "pt_BR" },
      }),
    ).rejects.toThrow(DeliveryStateError);
    expect(sendDirectMessageMock).not.toHaveBeenCalled();
  });

  it("wraps nothing: provider failures reach the dispatcher unchanged", async () => {
    const failure = new DeliveryProviderError("500 from graph", { status: 500 });
    const connector = new InstagramConnector({ client: fakeClient(failure).client });
    await expect(
      connector.sendMessage({
        account: { accountId: "ig-1", accountName: null, accessToken: "t" },
        recipientId: "u2",
        message: { type: "text", text: "x" },
      }),
    ).rejects.toBe(failure);
  });
});
