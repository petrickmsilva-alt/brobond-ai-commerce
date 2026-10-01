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
  /** Derived: status === CONNECTED. */
  connected: boolean;
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
  options: { publicKeyPreview?: string | null } = {},
): ConnectorCardDTO {
  const status: ConnectionStatus = row?.status ?? ("DISCONNECTED" as ConnectionStatus);
  return {
    provider: descriptor.provider,
    name: descriptor.name,
    description: descriptor.description,
    authType: descriptor.authType,
    status,
    connected: status === "CONNECTED",
    shopId: row?.shopId ?? null,
    shopName: row?.shopName ?? null,
    expiresAt: row?.expiresAt ? row.expiresAt.toISOString() : null,
    importedCount: row?.importedCount ?? 0,
    duplicatedCount: row?.duplicatedCount ?? 0,
    failedCount: row?.failedCount ?? 0,
    syncCount: row?.syncCount ?? 0,
    lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
    lastError: row?.lastError ?? null,
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
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
