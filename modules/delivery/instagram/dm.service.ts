import "server-only";

import type {
  DeliveryConnector,
  DeliverySendRequest,
  DeliverySendResult,
} from "../core/delivery.interface";
import { DeliveryProviderError, DeliveryStateError } from "../core/delivery.interface";
import { InstagramClient } from "./client";

/**
 * Instagram Direct — send service + connector implementation (PR010 §4/§6).
 *
 * Official Instagram Messaging API only (`POST /{ig-user-id}/messages`).
 * Instagram Business Messaging in PR010 sends TEXT Direct Messages; Meta
 * does not expose WhatsApp-style template sends on this surface, so a
 * template request is rejected deterministically (never silently coerced).
 */

export interface SendDirectMessageInput {
  accessToken: string;
  instagramAccountId: string;
  recipientId: string;
  text: string;
}

export interface SendDirectMessageResult {
  providerMessageId: string;
  recipientId: string | null;
}

export interface InstagramDmDependencies {
  client?: InstagramClient;
}

/** Low-level, server-only send. Throws DeliveryProviderError on API failure. */
export async function sendDirectMessage(
  input: SendDirectMessageInput,
  deps: InstagramDmDependencies = {},
): Promise<SendDirectMessageResult> {
  const client = deps.client ?? new InstagramClient();
  const response = await client.sendDirectMessage(input);
  if (!response.message_id) {
    throw new DeliveryProviderError("Instagram Messaging API did not return a message id.", {
      status: 502,
      retryable: true,
    });
  }
  return {
    providerMessageId: response.message_id,
    recipientId: response.recipient_id ?? null,
  };
}

/**
 * The INSTAGRAM connector — resolved exclusively through
 * `modules/delivery/core/delivery.factory.ts`.
 */
export class InstagramConnector implements DeliveryConnector {
  readonly channel = "INSTAGRAM" as const;

  constructor(private readonly deps: InstagramDmDependencies = {}) {}

  async sendMessage(request: DeliverySendRequest): Promise<DeliverySendResult> {
    if (request.message.type !== "text") {
      // Deterministic contract: templates are a WhatsApp Cloud API feature.
      throw new DeliveryStateError(
        "Instagram Business Messaging supports text messages only in PR010.",
      );
    }
    const result = await sendDirectMessage(
      {
        accessToken: request.account.accessToken,
        instagramAccountId: request.account.accountId,
        recipientId: request.recipientId,
        text: request.message.text,
      },
      this.deps,
    );
    return { providerMessageId: result.providerMessageId };
  }
}
