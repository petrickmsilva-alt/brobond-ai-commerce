/**
 * DTOs — the shapes the marketplace module exposes to the UI layer (PR012).
 *
 * Server components receive these objects and may pass them to client
 * components; they NEVER contain secret material (tokens, secrets, keys —
 * only masked previews) or cross-tenant data. Dates are ISO strings so
 * everything survives the RSC serialization boundary.
 */

import type { ConnectionStatus, Connector, ConnectorProvider } from "@prisma/client";
import type { ConnectorAuthType } from "./providers";

// ------------------------------------------------------------------
// RSC-serializable shapes
// ------------------------------------------------------------------

export type ConnectorCredentialSource = "database" | "environment" | null;

/** One marketplace/payment connector card in the dashboard grid. */
export interface ConnectorCardDTO {
  provider: ConnectorProvider;
  /** Display name from the registry ("TikTok Shop"…). */
  name: string;
  /** Short descriptor from the registry. */
  description: string;
  /** How the connection is established (redirect OAuth2 vs keys form). */
  authType: ConnectorAuthType;
  status: ConnectionStatus;
  /** Derived from the effective status (database plus server-side fallback). */
  connected: boolean;
  /**
   * A locked card has durable credentials and must not render credential or
   * disconnect controls. Currently used by Mercado Pago persistence.
   */
  locked: boolean;
  /** Safe provenance marker; credential values never cross this boundary. */
  credentialSource: ConnectorCredentialSource;
  shopId: string | null;
  shopName: string | null;
  expiresAt: string | null;
  importedCount: number;
  duplicatedCount: number;
  failedCount: number;
  syncCount: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Masked preview ("••••ab12") of the stored public key — never the value. */
  publicKeyPreview: string | null;
}

export type ConnectorCardMetrics = Pick<
  ConnectorCardDTO,
  "importedCount" | "duplicatedCount" | "failedCount" | "syncCount" | "lastSyncAt" | "lastError"
>;

export interface ConnectorCardOptions {
  publicKeyPreview?: string | null;
  /** Effective status override, e.g. Render's Mercado Pago credential fallback. */
  status?: ConnectionStatus;
  locked?: boolean;
  credentialSource?: ConnectorCredentialSource;
  /** Metrics fallback used when credentials are global and no Connector row exists. */
  metrics?: ConnectorCardMetrics;
}

/**
 * Build a card DTO from the registry descriptor plus the (possibly missing)
 * persisted row. A provider that was never connected has no `Connector` row
 * yet — it still renders, as DISCONNECTED with zeroed counters.
 */
export function toConnectorCardDTO(
  descriptor: {
    provider: ConnectorProvider;
    name: string;
    description: string;
    authType: ConnectorAuthType;
  },
  row: Connector | null,
  options: ConnectorCardOptions = {},
): ConnectorCardDTO {
  const status: ConnectionStatus =
    options.status ?? row?.status ?? ("DISCONNECTED" as ConnectionStatus);
  const metrics = options.metrics;

  return {
    provider: descriptor.provider,
    name: descriptor.name,
    description: descriptor.description,
    authType: descriptor.authType,
    status,
    connected: status === "CONNECTED",
    locked: options.locked ?? false,
    credentialSource: options.credentialSource ?? null,
    shopId: row?.shopId ?? null,
    shopName: row?.shopName ?? null,
    expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
    importedCount: metrics?.importedCount ?? row?.importedCount ?? 0,
    duplicatedCount: metrics?.duplicatedCount ?? row?.duplicatedCount ?? 0,
    failedCount: metrics?.failedCount ?? row?.failedCount ?? 0,
    syncCount: metrics?.syncCount ?? row?.syncCount ?? 0,
    lastSyncAt: metrics?.lastSyncAt ?? (row?.lastSyncAt ? row.lastSyncAt.toISOString() : null),
    lastError: metrics?.lastError ?? row?.lastError ?? null,
    publicKeyPreview: options.publicKeyPreview ?? null,
  };
}

/** Outcome of one real sync run, returned to the card for instant feedback. */
export interface MarketplaceSyncResultDTO {
  provider: ConnectorProvider;
  imported: number;
  duplicated: number;
  failed: number;
  syncedAt: string;
}

/** Uniform result for server actions (success or field/form errors). */
export type MarketplaceActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
