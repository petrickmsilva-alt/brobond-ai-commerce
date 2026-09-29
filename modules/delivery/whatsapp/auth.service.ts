import "server-only";

import { randomBytes } from "node:crypto";
import type { DeliveryAccount, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import {
  decryptDeliverySecret,
  encryptDeliverySecret,
  hashDeliveryOAuthState,
} from "../core/crypto.service";
import { DeliveryConfigurationError, DeliveryError } from "../core/delivery.interface";
import { metaAuthorizeUrl, type MetaApiConfig, getMetaApiConfig } from "../core/meta-client";
import {
  createDeliveryRepository,
  deliveryRepository,
  type DeliveryDatabase,
  type DeliveryRepository,
} from "../repositories/delivery.repository";
import { WHATSAPP_OAUTH_SCOPES, WhatsAppClient } from "./client";

/**
 * WhatsApp Business OAuth lifecycle (PR010 §5) — server-side ONLY.
 *
 * Implements the official Cloud API onboarding:
 *   connectWhatsApp() → Meta Embedded Signup dialog (random, hashed,
 *                       single-use state)
 *   exchangeToken()   → code → access token → sender phone-number
 *                       verification → encrypted upsert + AuditLog
 *
 * The sender identity is the Cloud API phone number id. It comes from
 * `WHATSAPP_PHONE_NUMBER_ID` (the operator-registered sender verified
 * against the freshly issued token) — the token itself never leaves the
 * server and is stored AES-256-GCM (`META_ENCRYPTION_KEY`).
 */

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export class WhatsAppOAuthError extends DeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppOAuthError";
  }
}

/** The OAuth redirect must match the Meta App configuration exactly. */
export function getWhatsAppRedirectUri(): string {
  const explicit = process.env.META_WHATSAPP_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.NEXTAUTH_URL?.trim();
  if (!appUrl) {
    throw new WhatsAppOAuthError(
      "NEXTAUTH_URL (or META_WHATSAPP_REDIRECT_URI) is required to construct the WhatsApp OAuth callback URL.",
    );
  }
  return `${appUrl.replace(/\/$/, "")}/api/whatsapp/callback`;
}

/** The registered Cloud API sender for this deployment (server-side only). */
export function getWhatsAppPhoneNumberId(): string {
  const value = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!value) {
    throw new WhatsAppOAuthError(
      "WHATSAPP_PHONE_NUMBER_ID is required to connect a WhatsApp Business sender.",
    );
  }
  return value;
}

export interface WhatsAppOAuthDependencies {
  db?: DeliveryDatabase;
  repository?: DeliveryRepository;
  config?: MetaApiConfig;
  now?: () => Date;
  randomState?: () => string;
  client?: WhatsAppClient;
  redirectUri?: string;
  phoneNumberId?: string;
  encrypt?: (plaintext: string) => string;
}

export function createWhatsAppOAuthService(deps: WhatsAppOAuthDependencies = {}) {
  const db = deps.db ?? prisma;
  const repository = deps.repository ?? createDeliveryRepository(db);
  const config = deps.config ?? null;
  const now = deps.now ?? (() => new Date());
  const randomState = deps.randomState ?? (() => randomBytes(32).toString("base64url"));
  const encrypt = deps.encrypt ?? ((plaintext: string) => encryptDeliverySecret(plaintext));
  const client = deps.client ?? null;

  function resolveClient(): WhatsAppClient {
    return client ?? new WhatsAppClient(config ?? getMetaApiConfig());
  }

  function resolveConfig(): MetaApiConfig {
    if (config) return config;
    try {
      return getMetaApiConfig();
    } catch (error) {
      if (error instanceof DeliveryConfigurationError) throw new WhatsAppOAuthError(error.message);
      throw error;
    }
  }

  return {
    /**
     * Start the official Embedded Signup flow. The browser receives ONLY
     * the Meta dialog URL; no app credential is ever embedded in the page
     * beyond Meta's own public dialog parameters.
     */
    async connectWhatsApp(organizationId: string): Promise<{ authorizationUrl: string }> {
      const scope = tenantWhere(organizationId);
      const current = now();
      await repository.purgeExpiredOAuthStates(scope.organizationId, current);
      const state = randomState();
      await repository.createOAuthState({
        organizationId: scope.organizationId,
        channel: "WHATSAPP",
        stateHash: hashDeliveryOAuthState(state),
        expiresAt: new Date(current.getTime() + OAUTH_STATE_TTL_MS),
      });

      const metaConfig = resolveConfig();
      const url = new URL(metaAuthorizeUrl());
      url.searchParams.set("client_id", metaConfig.appId);
      url.searchParams.set("redirect_uri", deps.redirectUri ?? getWhatsAppRedirectUri());
      url.searchParams.set("state", state);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", WHATSAPP_OAUTH_SCOPES.join(","));
      return { authorizationUrl: url.toString() };
    },

    /**
     * Complete the flow: consume the one-time state, exchange the code,
     * verify the registered sender phone number against the fresh token
     * and persist the encrypted credential.
     */
    async exchangeToken(input: { code: string; state: string }): Promise<DeliveryAccount> {
      const current = now();
      const stateHash = hashDeliveryOAuthState(input.state);
      const stored = await repository.findOAuthStateByHash(stateHash);
      if (!stored || stored.channel !== "WHATSAPP" || stored.expiresAt <= current) {
        if (stored) await db.deliveryOAuthState.deleteMany({ where: { id: stored.id } });
        throw new WhatsAppOAuthError(
          "WhatsApp authorization state is invalid or expired. Start the connection again.",
        );
      }
      const consumed = await repository.consumeOAuthState(stored.id, current);
      if (!consumed) {
        throw new WhatsAppOAuthError("WhatsApp authorization state has already been used.");
      }

      const whatsapp = resolveClient();
      const redirectUri = deps.redirectUri ?? getWhatsAppRedirectUri();
      const token = await whatsapp.exchangeToken(input.code, redirectUri);
      if (!token.access_token) {
        throw new WhatsAppOAuthError("Meta did not return an access token for WhatsApp.");
      }
      const expiresAt =
        typeof token.expires_in === "number" && token.expires_in > 0
          ? new Date(current.getTime() + token.expires_in * 1000)
          : null; // long-lived system user tokens report no expiry

      const phoneNumberId = deps.phoneNumberId ?? getWhatsAppPhoneNumberId();
      const sender = await whatsapp.getPhoneNumberInfo(phoneNumberId, token.access_token);
      if (!sender.id) {
        throw new WhatsAppOAuthError(
          "WhatsApp sender phone number could not be verified with the authorized token.",
        );
      }

      const saved = await repository.upsertConnectedAccount(stored.organizationId, {
        channel: "WHATSAPP",
        accountId: sender.id,
        accountName: sender.verified_name ?? sender.display_phone_number ?? null,
        encryptedAccessToken: encrypt(token.access_token),
        encryptedRefreshToken: null,
        expiresAt,
      });

      await repository.writeAuditLog({
        organizationId: stored.organizationId,
        action: "WHATSAPP_CONNECTED",
        entityType: "DeliveryAccount",
        entityId: saved.id,
        metadata: {
          phoneNumberId: sender.id,
          verifiedName: sender.verified_name ?? null,
        } as Prisma.InputJsonValue,
      });
      return saved;
    },

    /** Return the stored plaintext token (Cloud API tokens are long-lived). */
    async getValidAccessToken(organizationId: string, accountPk: string): Promise<string> {
      const account = await repository.findAccountById(organizationId, accountPk);
      if (!account?.encryptedAccessToken) {
        throw new WhatsAppOAuthError("WhatsApp account is disconnected or unknown.");
      }
      return decryptDeliverySecret(account.encryptedAccessToken);
    },

    /**
     * Local revocation: Meta deauthorization is configured app-side; here
     * we immediately destroy ciphertext so no further API call can be made.
     */
    async disconnectWhatsApp(organizationId: string, accountPk: string): Promise<boolean> {
      const disconnected = await repository.disconnectAccount(organizationId, accountPk);
      if (disconnected) {
        await repository.writeAuditLog({
          organizationId,
          action: "WHATSAPP_DISCONNECTED",
          entityType: "DeliveryAccount",
          entityId: accountPk,
        });
      }
      return disconnected;
    },
  };
}

export const whatsappOAuthService = createWhatsAppOAuthService({
  repository: deliveryRepository,
});

/** Public server-side methods required by the delivery contract (PR010 §5). */
export const connectWhatsApp = (organizationId: string) =>
  whatsappOAuthService.connectWhatsApp(organizationId);
export const exchangeToken = (input: { code: string; state: string }) =>
  whatsappOAuthService.exchangeToken(input);
export const disconnectWhatsApp = (organizationId: string, accountPk: string) =>
  whatsappOAuthService.disconnectWhatsApp(organizationId, accountPk);
