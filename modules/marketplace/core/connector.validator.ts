/**
 * Zod validation — single source of truth for every marketplace write path
 * (PR012): OAuth callbacks, the Mercado Pago keys form and the sync action.
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session, never accepted from the client.
 */

import { z } from "zod";
import { CONNECTOR_PROVIDERS } from "./providers";

export const connectorProviderSchema = z.enum(CONNECTOR_PROVIDERS, {
  errorMap: () => ({ message: `Provedor inválido. Use: ${CONNECTOR_PROVIDERS.join(", ")}.` }),
});

// ------------------------------------------------------------------
// OAuth callback payloads
// ------------------------------------------------------------------

/** Shopee Open Platform redirect query (?code=…&shop_id=…). */
export const shopeeCallbackSchema = z.object({
  code: z.string().trim().min(1),
  shop_id: z
    .string()
    .trim()
    .regex(/^\d+$/, "shop_id inválido."),
});

export type ShopeeCallbackInput = z.infer<typeof shopeeCallbackSchema>;

/** Mercado Livre OAuth redirect query (?code=…&state=…). */
export const mercadoLivreCallbackSchema = z.object({
  code: z.string().trim().min(1),
  state: z.string().trim().min(16),
});

export type MercadoLivreCallbackInput = z.infer<typeof mercadoLivreCallbackSchema>;

// ------------------------------------------------------------------
// Mercado Pago API keys form
// ------------------------------------------------------------------

/**
 * Production credentials of a Mercado Pago seller account. Access tokens
 * follow the `APP_USR-…` shape; public keys `APP_USR-…` (production) or
 * `TEST-…` (sandbox, accepted for homologation).
 */
export const mercadoPagoConnectSchema = z.object({
  accessToken: z
    .string({ invalid_type_error: "Informe o Access Token." })
    .trim()
    .min(20, "Access Token muito curto.")
    .max(300, "Access Token acima do limite suportado.")
    .regex(/^(APP_USR|TEST)-[A-Za-z0-9-]+$/, "Formato de Access Token inválido."),
  publicKey: z
    .string({ invalid_type_error: "Informe a Public Key." })
    .trim()
    .min(10, "Public Key muito curta.")
    .max(300, "Public Key acima do limite suportado.")
    .regex(/^(APP_USR|TEST)-[A-Za-z0-9-]+$/, "Formato de Public Key inválido."),
});

export type MercadoPagoConnectInput = z.infer<typeof mercadoPagoConnectSchema>;

// ------------------------------------------------------------------
// Sync input (server action → sync service)
// ------------------------------------------------------------------

export const MARKETPLACE_SYNC_LIMIT_DEFAULT = 50;
export const MARKETPLACE_SYNC_LIMIT_MAX = 200;

/** Payload accepted by the "Sincronizar" action — provider + optional cap. */
export const syncMarketplaceSchema = z.object({
  provider: connectorProviderSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1, "O limite mínimo é 1.")
    .max(MARKETPLACE_SYNC_LIMIT_MAX, `O limite máximo é ${MARKETPLACE_SYNC_LIMIT_MAX}.`)
    .default(MARKETPLACE_SYNC_LIMIT_DEFAULT),
});

export type SyncMarketplaceInput = z.input<typeof syncMarketplaceSchema>;
