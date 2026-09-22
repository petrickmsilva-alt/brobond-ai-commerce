/**
 * Connector Framework — module contracts (PR005).
 *
 * This file is the plug-in surface of the connector layer: the `Connector`
 * interface every platform adapter implements, the normalized content shape
 * they return and the client-safe mirrors of the Prisma enums.
 *
 * SCOPE OF PR005 — ARCHITECTURE ONLY.
 * No real API is integrated: `MockConnector` is the single implemented
 * adapter; TikTok, Instagram and Shopee are placeholders that throw
 * `ConnectorNotImplementedError`. There is zero network access, zero
 * scraping, zero SDK and zero credential handling anywhere in the module.
 *
 * CLIENT-SAFE on purpose: this file must never import `@prisma/client` as a
 * runtime value (only as a type) — the dashboard imports the platform list
 * and the labels to render its filters.
 */

import type {
  ConnectorPlatform,
  ConnectorState,
  ExternalContentStatus,
  ExternalContentType,
} from "@prisma/client";

// ------------------------------------------------------------------
// Platforms
// ------------------------------------------------------------------

/**
 * The platforms the framework knows about. Kept in sync with the Prisma
 * `ConnectorPlatform` enum (`prisma/schema.prisma`); the sync is pinned by
 * `tests/connector-platform.test.ts`.
 */
export const CONNECTOR_PLATFORMS = ["MOCK", "TIKTOK", "INSTAGRAM", "SHOPEE"] as const;

export type ConnectorPlatformName = (typeof CONNECTOR_PLATFORMS)[number];

/** The only platform actually implemented in PR005. */
export const DEFAULT_CONNECTOR_PLATFORM: ConnectorPlatformName = "MOCK";

/**
 * Platforms whose adapter is a placeholder (`fetchContent()` throws).
 * Single source of truth for the "🧩 placeholder" badge in the dashboard.
 */
export const PLACEHOLDER_CONNECTOR_PLATFORMS: readonly ConnectorPlatformName[] = [
  "TIKTOK",
  "INSTAGRAM",
  "SHOPEE",
];

/** pt-BR display labels for the dashboard. */
export const CONNECTOR_PLATFORM_LABELS: Record<ConnectorPlatformName, string> = {
  MOCK: "Mock",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  SHOPEE: "Shopee",
};

// ------------------------------------------------------------------
// Connector state
// ------------------------------------------------------------------

/**
 * Operational state of one connector inside one workspace. Kept in sync
 * with the Prisma `ConnectorState` enum.
 *
 *   IDLE     — registered, never synced
 *   ACTIVE   — last sync succeeded
 *   ERROR    — last sync failed
 *   DISABLED — turned off by an ADMIN
 */
export const CONNECTOR_STATES = ["IDLE", "ACTIVE", "ERROR", "DISABLED"] as const;

export type ConnectorStateName = (typeof CONNECTOR_STATES)[number];

/** The state a freshly registered connector starts at. */
export const DEFAULT_CONNECTOR_STATE: ConnectorStateName = "IDLE";

/** pt-BR display labels for the connector state badge. */
export const CONNECTOR_STATE_LABELS: Record<ConnectorStateName, string> = {
  IDLE: "Ocioso",
  ACTIVE: "Ativo",
  ERROR: "Erro",
  DISABLED: "Desativado",
};

/**
 * Which states count as an "active connector" for the dashboard KPI.
 * A connector is active when the workspace enabled it AND its last run did
 * not fail — the predicate below is the single source of truth.
 */
export function isConnectorActive(status: {
  enabled: boolean;
  state: ConnectorState | ConnectorStateName;
}): boolean {
  return status.enabled && status.state === "ACTIVE";
}

// ------------------------------------------------------------------
// External content
// ------------------------------------------------------------------

/** Kinds of content a connector may import. Mirrors `ExternalContentType`. */
export const EXTERNAL_CONTENT_TYPES = ["VIDEO", "IMAGE", "POST", "PRODUCT", "LIVE"] as const;

export type ExternalContentTypeName = (typeof EXTERNAL_CONTENT_TYPES)[number];

/** Import outcomes. Mirrors `ExternalContentStatus`. */
export const EXTERNAL_CONTENT_STATUSES = ["IMPORTED", "DUPLICATE", "FAILED"] as const;

export type ExternalContentStatusName = (typeof EXTERNAL_CONTENT_STATUSES)[number];

/** pt-BR labels for the import-status badge / KPI cards. */
export const EXTERNAL_CONTENT_STATUS_LABELS: Record<ExternalContentStatusName, string> = {
  IMPORTED: "Importado",
  DUPLICATE: "Duplicado",
  FAILED: "Falha",
};

/** pt-BR labels for the content-type badge. */
export const EXTERNAL_CONTENT_TYPE_LABELS: Record<ExternalContentTypeName, string> = {
  VIDEO: "Vídeo",
  IMAGE: "Imagem",
  POST: "Post",
  PRODUCT: "Produto",
  LIVE: "Live",
};

/**
 * The NORMALIZED shape every connector returns — the whole point of the
 * framework. A platform adapter is responsible for mapping its provider
 * payload onto this contract, so nothing downstream (repository, KPIs,
 * dashboard) ever knows which platform it came from.
 *
 * `externalId` is the dedupe key: `(organizationId, platform, externalId)`
 * is unique in the database, so re-importing the same item is recorded as
 * a DUPLICATE instead of duplicating a row.
 */
export interface NormalizedContent {
  /** Stable id of the item on the origin platform (dedupe key). */
  externalId: string;
  type: ExternalContentTypeName;
  title: string;
  url?: string;
  thumbnailUrl?: string;
  /** Author handle on the origin platform, e.g. "@ana.souza". */
  authorHandle?: string;
  caption?: string;
  views?: number;
  likes?: number;
  shares?: number;
  /** Publication time on the origin platform (NOT the import time). */
  publishedAt?: Date;
  /** Verbatim provider payload, kept for future re-processing. */
  raw?: Record<string, unknown>;
}

/** Options accepted by `fetchContent()` — every field is optional. */
export interface FetchContentOptions {
  /** Max items to return. Adapters must honour it (mock slices the dataset). */
  limit?: number;
  /** Only content published at/after this instant. */
  since?: Date;
  /** Restrict to one content type. */
  type?: ExternalContentTypeName;
}

/** Outcome of `testConnection()` — never throws, always reports. */
export interface ConnectorHealth {
  platform: ConnectorPlatform;
  /** `true` only when the adapter can actually serve content. */
  ok: boolean;
  /** `false` for every placeholder adapter (PR005: all but MOCK). */
  implemented: boolean;
  /** Human-readable pt-BR explanation shown in the dashboard. */
  message: string;
}

// ------------------------------------------------------------------
// The Connector contract
// ------------------------------------------------------------------

/**
 * A platform connector. Implementations must be side-effect free at
 * construction time (the factory instantiates them lazily and caches them)
 * and are resolved EXCLUSIVELY through
 * `getConnector(platform)` (`connector.factory.ts`) — never instantiated
 * ad hoc by callers and never chosen through a `switch` outside the factory.
 *
 * PR005 performs no network access: `MockConnector` returns a deterministic
 * in-memory dataset and the three platform adapters throw
 * `ConnectorNotImplementedError`.
 */
export interface Connector {
  /** Which platform this connector talks to (Prisma `ConnectorPlatform`). */
  readonly platform: ConnectorPlatform;
  /** Human-readable name shown in the dashboard. */
  readonly name: string;
  /**
   * `false` while the adapter is a placeholder. The dashboard and the sync
   * service read this instead of try/catching `fetchContent()`.
   */
  readonly implemented: boolean;
  /**
   * Fetch content from the platform, already normalized.
   * @throws {ConnectorNotImplementedError} for placeholder adapters.
   */
  fetchContent(options?: FetchContentOptions): Promise<NormalizedContent[]>;
  /**
   * Probe the connector. NEVER throws — a placeholder reports
   * `{ ok: false, implemented: false }` so the UI can render it calmly.
   */
  testConnection(): Promise<ConnectorHealth>;
}

// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------

/**
 * Thrown by a placeholder adapter's `fetchContent()`. A dedicated class (and
 * not a bare `Error`) so the sync service can record a precise reason on
 * `ConnectorStatus.lastError` without string matching.
 */
export class ConnectorNotImplementedError extends Error {
  readonly platform: ConnectorPlatform;

  constructor(platform: ConnectorPlatform, detail?: string) {
    super(
      detail ??
        `O conector "${String(platform)}" ainda não foi implementado — PR005 entrega apenas a arquitetura (nenhuma API real é integrada).`,
    );
    this.name = "ConnectorNotImplementedError";
    this.platform = platform;
  }
}

/** Thrown by the factory when no adapter is registered for a platform. */
export class ConnectorNotRegisteredError extends Error {
  readonly platform: string;

  constructor(platform: string) {
    super(`No Connector is registered for platform "${platform}".`);
    this.name = "ConnectorNotRegisteredError";
    this.platform = platform;
  }
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

/**
 * Build a `ConnectorHealth` payload for a placeholder adapter. Shared by
 * the three platform placeholders so their message stays identical.
 */
export function placeholderHealth(platform: ConnectorPlatform, name: string): ConnectorHealth {
  return {
    platform,
    ok: false,
    implemented: false,
    message: `${name}: placeholder — nenhuma API real é integrada em PR005.`,
  };
}

/** Type guard: is a value one of the known platforms? */
export function isConnectorPlatformName(value: unknown): value is ConnectorPlatformName {
  return (
    typeof value === "string" &&
    (CONNECTOR_PLATFORMS as readonly string[]).includes(value as ConnectorPlatformName)
  );
}

/** Type guard: is a value one of the known import statuses? */
export function isExternalContentStatusName(value: unknown): value is ExternalContentStatusName {
  return (
    typeof value === "string" &&
    (EXTERNAL_CONTENT_STATUSES as readonly string[]).includes(value as ExternalContentStatusName)
  );
}

/** Re-exported Prisma types, so callers import one module only. */
export type { ConnectorPlatform, ConnectorState, ExternalContentStatus, ExternalContentType };
