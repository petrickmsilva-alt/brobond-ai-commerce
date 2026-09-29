import "server-only";

import type {
  DeliveryConnector,
  DeliverySendRequest,
  DeliverySendResult,
  WhatsAppTemplateComponent,
} from "../core/delivery.interface";
import { WhatsAppClient } from "./client";

/**
 * WhatsApp Cloud API — message service + connector implementation
 * (PR010 §5/§6). Official `POST /{phone-number-id}/messages` endpoint ONLY:
 *   - sendText()     → free-form text (24h customer service window)
 *   - sendTemplate() → pre-approved template (works outside the window)
 */

export interface WhatsAppSendDependencies {
  client?: WhatsAppClient;
}

export interface SendWhatsAppTextInput {
  accessToken: string;
  phoneNumberId: string;
  recipientId: string;
  text: string;
}

export interface SendWhatsAppTemplateInput {
  accessToken: string;
  phoneNumberId: string;
  recipientId: string;
  templateName: string;
  language: string;
  components?: WhatsAppTemplateComponent[];
}

export interface SendWhatsAppResult {
  providerMessageId: string;
  waId: string | null;
}

/** Low-level, server-only TEXT send through the official Cloud API. */
export async function sendText(
  input: SendWhatsAppTextInput,
  deps: WhatsAppSendDependencies = {},
): Promise<SendWhatsAppResult> {
  const client = deps.client ?? new WhatsAppClient();
  return client.sendMessage({
    accessToken: input.accessToken,
    phoneNumberId: input.phoneNumberId,
    recipientId: input.recipientId,
    body: client.buildTextBody(input.text),
  });
}

/** Low-level, server-only TEMPLATE send through the official Cloud API. */
export async function sendTemplate(
  input: SendWhatsAppTemplateInput,
  deps: WhatsAppSendDependencies = {},
): Promise<SendWhatsAppResult> {
  const client = deps.client ?? new WhatsAppClient();
  return client.sendMessage({
    accessToken: input.accessToken,
    phoneNumberId: input.phoneNumberId,
    recipientId: input.recipientId,
    body: client.buildTemplateBody({
      templateName: input.templateName,
      language: input.language,
      components: input.components,
    }),
  });
}

/**
 * The WHATSAPP connector — resolved exclusively through
 * `modules/delivery/core/delivery.factory.ts`.
 */
export class WhatsAppConnector implements DeliveryConnector {
  readonly channel = "WHATSAPP" as const;

  constructor(private readonly deps: WhatsAppSendDependencies = {}) {}

  async sendMessage(request: DeliverySendRequest): Promise<DeliverySendResult> {
    const message = request.message;
    const result =
      message.type === "text"
        ? await sendText(
            {
              accessToken: request.account.accessToken,
              phoneNumberId: request.account.accountId,
              recipientId: request.recipientId,
              text: message.text,
            },
            this.deps,
          )
        : await sendTemplate(
            {
              accessToken: request.account.accessToken,
              phoneNumberId: request.account.accountId,
              recipientId: request.recipientId,
              templateName: message.templateName,
              language: message.language,
              components: message.components,
            },
            this.deps,
          );
    return { providerMessageId: result.providerMessageId };
  }
}
