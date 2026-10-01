import "server-only";

import type { ConnectorProvider } from "@prisma/client";

/**
 * Marketplace domain errors (PR012). Dedicated classes (never bare `Error`)
 * so route handlers and server actions can map precise, sanitized messages
 * without string matching — and never leak provider payloads to the browser.
 */

/** Base class for every marketplace integration failure. */
export class MarketplaceError extends Error {
  readonly provider?: ConnectorProvider;

  constructor(message: string, provider?: ConnectorProvider) {
    super(message);
    this.name = "MarketplaceError";
    this.provider = provider;
  }
}

/** The workspace has no CONNECTED credential for the requested provider. */
export class ConnectorNotConnectedError extends MarketplaceError {
  constructor(provider: ConnectorProvider) {
    super(
      `O conector "${String(provider)}" não está conectado. Conecte a conta antes de sincronizar.`,
      provider,
    );
    this.name = "ConnectorNotConnectedError";
  }
}

/** The stored credential expired and could not be refreshed automatically. */
export class ConnectorTokenExpiredError extends MarketplaceError {
  constructor(provider: ConnectorProvider) {
    super(
      `A credencial do conector "${String(provider)}" expirou. Reconecte a conta para continuar.`,
      provider,
    );
    this.name = "ConnectorTokenExpiredError";
  }
}

/** A required environment variable for one provider is missing. */
export class ConnectorConfigError extends MarketplaceError {
  constructor(variable: string, provider?: ConnectorProvider) {
    super(`A variável de ambiente ${variable} é obrigatória para este conector.`, provider);
    this.name = "ConnectorConfigError";
  }
}

/** A provider API call failed (network, auth, rate limit or 5xx). */
export class ProviderApiError extends MarketplaceError {
  readonly status: number;

  constructor(message: string, status: number, provider?: ConnectorProvider) {
    super(message, provider);
    this.name = "ProviderApiError";
    this.status = status;
  }
}

/** A webhook arrived with an invalid or unverifiable signature. */
export class WebhookSignatureError extends MarketplaceError {
  constructor(provider: ConnectorProvider) {
    super(`Assinatura de webhook inválida para "${String(provider)}".`, provider);
    this.name = "WebhookSignatureError";
  }
}
