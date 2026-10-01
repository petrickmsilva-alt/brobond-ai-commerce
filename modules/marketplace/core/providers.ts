/**
 * Marketplace provider registry (PR012 — Real Marketplace Integrations).
 *
 * The single source of truth for WHICH providers exist, how each one
 * authenticates and how the dashboard labels them. Kept in sync with the
 * Prisma `ConnectorProvider` enum (`prisma/schema.prisma`).
 *
 * CLIENT-SAFE on purpose: this file must never import `@prisma/client` as a
 * runtime value (only as a type) and must never read `process.env` — the
 * connectors grid imports the registry to render the five cards.
 */

import type { ConnectionStatus, ConnectorProvider } from "@prisma/client";

// ------------------------------------------------------------------
// Providers
// ------------------------------------------------------------------

export const CONNECTOR_PROVIDERS = [
  "TIKTOK",
  "INSTAGRAM",
  "SHOPEE",
  "MERCADOLIVRE",
  "MERCADOPAGO",
] as const;

export type ConnectorProviderName = (typeof CONNECTOR_PROVIDERS)[number];

/** pt-BR display labels for the five connector cards. */
export const CONNECTOR_PROVIDER_LABELS: Record<ConnectorProviderName, string> = {
  TIKTOK: "TikTok Shop",
  INSTAGRAM: "Instagram Shopping",
  SHOPEE: "Shopee",
  MERCADOLIVRE: "Mercado Livre",
  MERCADOPAGO: "Mercado Pago",
};

/** Short pt-BR descriptor shown under the card title. */
export const CONNECTOR_PROVIDER_DESCRIPTIONS: Record<ConnectorProviderName, string> = {
  TIKTOK: "Catálogo e pedidos via TikTok Shop Partner Center (OAuth2 oficial).",
  INSTAGRAM: "Instagram Shopping via Graph API / Facebook Login oficial.",
  SHOPEE: "Shopee Open Platform v2 com assinatura HMAC-SHA256.",
  MERCADOLIVRE: "Meli API oficial — OAuth2 com refresh token automático.",
  MERCADOPAGO: "Checkout e faturamento via Access Token de produção.",
};

// ------------------------------------------------------------------
// Authentication model
// ------------------------------------------------------------------

/**
 * How a provider connection is established:
 *   `oauth2`  → browser redirect to the provider's official authorization
 *               page, then a server-side code exchange on the callback;
 *   `apikeys` → the operator pastes production credentials into a form
 *               (Mercado Pago Access Token + Public Key).
 */
export type ConnectorAuthType = "oauth2" | "apikeys";

export const CONNECTOR_PROVIDER_AUTH: Record<ConnectorProviderName, ConnectorAuthType> = {
  TIKTOK: "oauth2",
  INSTAGRAM: "oauth2",
  SHOPEE: "oauth2",
  MERCADOLIVRE: "oauth2",
  MERCADOPAGO: "apikeys",
};

// ------------------------------------------------------------------
// Connection status
// ------------------------------------------------------------------

export const CONNECTION_STATUSES = ["DISCONNECTED", "CONNECTED", "EXPIRED", "ERROR"] as const;

export type ConnectionStatusName = (typeof CONNECTION_STATUSES)[number];

/** pt-BR labels for the connection status badge. */
export const CONNECTION_STATUS_LABELS: Record<ConnectionStatusName, string> = {
  DISCONNECTED: "Desconectado",
  CONNECTED: "Conectado",
  EXPIRED: "Expirado",
  ERROR: "Erro",
};

/**
 * Which statuses count as "connected" for the dashboard KPI — the single
 * source of truth: the credential exists and is currently usable.
 */
export function isProviderConnected(status: ConnectionStatus | ConnectionStatusName): boolean {
  return status === "CONNECTED";
}

// ------------------------------------------------------------------
// Type guards
// ------------------------------------------------------------------

/** Type guard: is a value one of the five real providers? */
export function isConnectorProviderName(value: unknown): value is ConnectorProviderName {
  return (
    typeof value === "string" &&
    (CONNECTOR_PROVIDERS as readonly string[]).includes(value as ConnectorProviderName)
  );
}

/** Type guard: is a value one of the known connection statuses? */
export function isConnectionStatusName(value: unknown): value is ConnectionStatusName {
  return (
    typeof value === "string" &&
    (CONNECTION_STATUSES as readonly string[]).includes(value as ConnectionStatusName)
  );
}

/** Re-exported Prisma types, so callers import one module only. */
export type { ConnectionStatus, ConnectorProvider };
