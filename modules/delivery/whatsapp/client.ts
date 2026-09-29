import "server-only";

import { DeliveryProviderError } from "../core/delivery.interface";
import {
  MetaGraphClient,
  getMetaApiConfig,
  type MetaApiConfig,
  type MetaHttpDependencies,
} from "../core/meta-client";
import type { WhatsAppTemplateComponent } from "../core/delivery.interface";

/**
 * WhatsApp Business Cloud API client (PR010 §5) — official Meta endpoints
 * ONLY:
 *  - `GET /oauth/access_token` (Embedded Signup code exchange)
 *  - `GET /{phone-number-id}` (sender verification)
 *  - `POST /{phone-number-id}/messages` (text + template sends)
 *
 * No scraping, no browser automation, no unofficial gateways.
 */

/** OAuth scopes requested for WhatsApp Business messaging (Embedded Signup). */
export const WHATSAPP_OAUTH_SCOPES = [
  "whatsapp_business_messaging",
  "whatsapp_business_management",
] as const;

export interface WhatsAppTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export interface WhatsAppPhoneNumberInfo {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

interface WhatsAppSendResponse {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string }>;
}

export class WhatsAppApiError extends DeliveryProviderError {
  constructor(message: string, options: { status: number; code?: number; retryable?: boolean }) {
    super(message, options);
    this.name = "WhatsAppApiError";
  }
}

export class WhatsAppClient {
  private readonly config: MetaApiConfig;
  private readonly http: MetaGraphClient;

  constructor(config: MetaApiConfig = getMetaApiConfig(), deps: MetaHttpDependencies = {}) {
    this.config = config;
    this.http = new MetaGraphClient(config, deps);
  }

  /** Exchange an Embedded Signup authorization code for an access token. */
  async exchangeToken(code: string, redirectUri: string): Promise<WhatsAppTokenResponse> {
    return this.http.request<WhatsAppTokenResponse>({
      path: "/oauth/access_token",
      query: {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });
  }

  /** Verify a sender phone number id and fetch its display identity. */
  async getPhoneNumberInfo(
    phoneNumberId: string,
    accessToken: string,
  ): Promise<WhatsAppPhoneNumberInfo> {
    return this.http.request<WhatsAppPhoneNumberInfo>({
      path: `/${encodeURIComponent(phoneNumberId)}`,
      accessToken,
      query: { fields: "id,display_phone_number,verified_name,quality_rating" },
    });
  }

  /**
   * Send a Cloud API message. Returns the provider `wamid` used to join
   * status webhooks (sent/delivered/read).
   */
  async sendMessage(input: {
    accessToken: string;
    phoneNumberId: string;
    recipientId: string;
    body: Record<string, unknown>;
  }): Promise<{ providerMessageId: string; waId: string | null }> {
    const response = await this.http.request<WhatsAppSendResponse>({
      method: "POST",
      path: `/${encodeURIComponent(input.phoneNumberId)}/messages`,
      accessToken: input.accessToken,
      body: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.recipientId,
        ...input.body,
      },
    });
    const providerMessageId = response.messages?.[0]?.id;
    if (!providerMessageId) {
      throw new WhatsAppApiError("WhatsApp Cloud API did not return a message id.", {
        status: 502,
        retryable: true,
      });
    }
    return { providerMessageId, waId: response.contacts?.[0]?.wa_id ?? null };
  }

  /** Outbound free-form text (inside the 24h customer service window). */
  buildTextBody(text: string): Record<string, unknown> {
    return { type: "text", text: { body: text, preview_url: false } };
  }

  /** Outbound pre-approved template (works outside the 24h window). */
  buildTemplateBody(input: {
    templateName: string;
    language: string;
    components?: WhatsAppTemplateComponent[];
  }): Record<string, unknown> {
    return {
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.language },
        ...(input.components?.length ? { components: input.components } : {}),
      },
    };
  }
}

/** Factory kept symmetrical with the connector factory (test seam). */
export function createWhatsAppClient(
  config?: MetaApiConfig,
  deps?: MetaHttpDependencies,
): WhatsAppClient {
  return new WhatsAppClient(config, deps);
}
