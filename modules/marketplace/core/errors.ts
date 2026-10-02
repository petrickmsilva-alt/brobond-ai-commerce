import "server-only";

import type { ConnectorProvider } from "@prisma/client";

/**
 * Marketplace domain errors (PR012). Dedicated classes (never bare `Error`)
 * so route handlers and server actions can map precise, sanitized messages
 * without string matching — and never leak provider payloads to the browser.
 */

/** Options every marketplace error accepts (kept optional for callers). */
export interface MarketplaceErrorOptions {
  /**
   * `true` when the ONLY fix is sending the operator back through the
   * provider's OAuth flow (no token yet, token revoked/expired, credential
   * undecryptable after a key rotation). The dashboard turns this flag into
   * the "Conectar Conta do …" call to action instead of a dead-end message.
   */
  requiresReauth?: boolean;
  /** Underlying cause, preserved for the server logs — never for the UI. */
  cause?: unknown;
  /**
   * The provider's own protocol error code (OAuth `error` field, e.g.
   * `invalid_grant` or `invalid_request`) when one exists. Server-side
   * diagnostic routing only — never rendered verbatim to the browser.
   */
  providerCode?: string;
}

/** Base class for every marketplace integration failure. */
export class MarketplaceError extends Error {
  readonly provider?: ConnectorProvider;
  /** Whether the UI must offer re-authentication (see the options doc). */
  readonly requiresReauth: boolean;
  /** The provider's protocol error code, when known (server logs only). */
  readonly providerCode?: string;

  constructor(
    message: string,
    provider?: ConnectorProvider,
    options: MarketplaceErrorOptions = {},
  ) {
    super(message);
    this.name = "MarketplaceError";
    this.provider = provider;
    this.requiresReauth = options.requiresReauth ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
    if (options.providerCode !== undefined) this.providerCode = options.providerCode;
  }
}

/** The workspace has no CONNECTED credential for the requested provider. */
export class ConnectorNotConnectedError extends MarketplaceError {
  constructor(provider: ConnectorProvider) {
    super(
      `O conector "${String(provider)}" não está conectado. Conecte a conta antes de sincronizar.`,
      provider,
      { requiresReauth: true },
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
      { requiresReauth: true },
    );
    this.name = "ConnectorTokenExpiredError";
  }
}

/**
 * The provider refused the stored credential (401/403, revoked grant, failed
 * refresh, ciphertext that no longer decrypts after a
 * `CONNECTOR_ENCRYPTION_KEY` rotation).
 *
 * Distinct from `ProviderApiError`: retrying changes nothing, the operator
 * has to authorize the account again. The message is written FOR the panel —
 * it names the action the user must take, never the provider's raw payload.
 */
export class ConnectorReauthRequiredError extends MarketplaceError {
  constructor(provider: ConnectorProvider, message: string, options: MarketplaceErrorOptions = {}) {
    super(message, provider, { ...options, requiresReauth: true });
    this.name = "ConnectorReauthRequiredError";
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

  constructor(
    message: string,
    status: number,
    provider?: ConnectorProvider,
    options: MarketplaceErrorOptions = {},
  ) {
    super(message, provider, options);
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

/**
 * Does this failure mean "authorize the account again"?
 *
 * The single predicate shared by the sync service (which downgrades the
 * connector to EXPIRED instead of ERROR), the server actions (which forward
 * the flag to the browser) and the dashboard (which renders the reconnect
 * call to action). Accepts `unknown` so `catch` blocks can call it directly.
 */
export function requiresReauthentication(error: unknown): boolean {
  if (error instanceof MarketplaceError) return error.requiresReauth;
  // Structural check so the connector-framework adapters
  // (`MercadoLivreConnectionRequiredError` & friends, which live outside
  // this module's class hierarchy) participate without a circular import.
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { requiresReauth?: unknown }).requiresReauth === true
  );
}
