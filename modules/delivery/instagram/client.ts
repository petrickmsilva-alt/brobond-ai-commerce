import "server-only";

import { DeliveryProviderError } from "../core/delivery.interface";
import {
  MetaGraphClient,
  getMetaApiConfig,
  type MetaApiConfig,
  type MetaHttpDependencies,
} from "../core/meta-client";

/**
 * Instagram Business Messaging client (PR010) — typed wrapper over the
 * official Meta Graph API. Official endpoints ONLY:
 *  - `GET  /oauth/access_token` (short-lived code exchange, fb_exchange_token)
 *  - `GET  /me/accounts` + nested `instagram_business_account` discovery
 *  - `POST /{ig-user-id}/messages` (Instagram Messaging API)
 *
 * No scraping, no browser automation, no unofficial endpoints.
 */

/** OAuth scopes requested for Instagram Business Messaging. */
export const INSTAGRAM_OAUTH_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "pages_show_list",
] as const;

export interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  /** Seconds until expiry; `0`/absent = non-expiring (system tokens). */
  expires_in?: number;
}

export interface InstagramBusinessAccount {
  /** Instagram Business Account id (the messaging sender identity). */
  id: string;
  username?: string;
  name?: string;
}

interface FacebookPage {
  id?: string;
  name?: string;
  instagram_business_account?: { id?: string; username?: string };
}

export interface InstagramSendMessageResponse {
  recipient_id?: string;
  message_id?: string;
}

export class InstagramApiError extends DeliveryProviderError {
  constructor(message: string, options: { status: number; code?: number; retryable?: boolean }) {
    super(message, options);
    this.name = "InstagramApiError";
  }
}

export class InstagramClient {
  private readonly config: MetaApiConfig;
  private readonly http: MetaGraphClient;

  constructor(config: MetaApiConfig = getMetaApiConfig(), deps: MetaHttpDependencies = {}) {
    this.config = config;
    this.http = new MetaGraphClient(config, deps);
  }

  /** Exchange an authorization code for a short-lived user access token. */
  async exchangeCode(code: string, redirectUri: string): Promise<MetaTokenResponse> {
    return this.http.request<MetaTokenResponse>({
      path: "/oauth/access_token",
      query: {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: redirectUri,
        code,
      },
    });
  }

  /** Upgrade a short-lived token to a long-lived (~60 day) token. */
  async exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
    return this.http.request<MetaTokenResponse>({
      path: "/oauth/access_token",
      query: {
        grant_type: "fb_exchange_token",
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        fb_exchange_token: shortLivedToken,
      },
    });
  }

  /** Refresh a still-valid long-lived token (Meta rotation contract). */
  async refreshLongLivedToken(currentToken: string): Promise<MetaTokenResponse> {
    return this.exchangeForLongLivedToken(currentToken);
  }

  /** Discover every Instagram Business account linked to the user's Pages. */
  async listBusinessAccounts(userAccessToken: string): Promise<InstagramBusinessAccount[]> {
    const response = await this.http.request<{ data?: FacebookPage[] }>({
      path: "/me/accounts",
      accessToken: userAccessToken,
      query: { fields: "id,name,instagram_business_account{id,username}" },
    });
    return (response.data ?? [])
      .filter((page) => page.instagram_business_account?.id)
      .map((page) => ({
        id: page.instagram_business_account!.id!,
        username: page.instagram_business_account!.username,
        name: page.name,
      }));
  }

  /**
   * Send an Instagram Direct text message — official Messaging API.
   * Returns the provider `message_id` used to join webhook receipts.
   */
  async sendDirectMessage(input: {
    accessToken: string;
    instagramAccountId: string;
    recipientId: string;
    text: string;
  }): Promise<InstagramSendMessageResponse> {
    return this.http.request<InstagramSendMessageResponse>({
      method: "POST",
      path: `/${encodeURIComponent(input.instagramAccountId)}/messages`,
      accessToken: input.accessToken,
      body: {
        recipient: { id: input.recipientId },
        messaging_type: "RESPONSE",
        message: { text: input.text },
      },
    });
  }
}

/** Factory kept symmetrical with the connector factory (test seam). */
export function createInstagramClient(
  config?: MetaApiConfig,
  deps?: MetaHttpDependencies,
): InstagramClient {
  return new InstagramClient(config, deps);
}
