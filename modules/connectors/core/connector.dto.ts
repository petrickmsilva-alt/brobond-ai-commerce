/**
 * DTOs — the shapes the connectors module exposes to the UI layer.
 *
 * Server components receive these objects and may pass them to client
 * components; they never contain secret material or cross-tenant data.
 * Dates are ISO strings so everything survives the RSC serialization
 * boundary.
 */

import type {
  ConnectorPlatform,
  ConnectorState,
  ConnectorStatus,
  ExternalContent,
  ExternalContentStatus,
  ExternalContentType,
  Prisma,
} from "@prisma/client";
import type { NormalizedContent } from "./connector.interface";

// ------------------------------------------------------------------
// Persistence payloads
// ------------------------------------------------------------------

/** Payload persisted as one `ExternalContent` row (import path). */
export interface CreateExternalContentDTO {
  platform: ConnectorPlatform;
  externalId: string;
  type: ExternalContentType;
  status: ExternalContentStatus;
  title: string;
  url?: string;
  thumbnailUrl?: string;
  authorHandle?: string;
  caption?: string;
  views: number;
  likes: number;
  shares: number;
  publishedAt?: Date;
  errorReason?: string;
  raw?: Prisma.InputJsonValue;
  connectorStatusId?: string;
}

/**
 * Map a validated normalized item to its persistence payload.
 *
 * The status is decided by the SYNC SERVICE (IMPORTED / DUPLICATE /
 * FAILED), never by the connector — an adapter can only describe content,
 * it can never declare its own import outcome.
 */
export function toCreateExternalContentDTO(
  content: NormalizedContent,
  platform: ConnectorPlatform,
  status: ExternalContentStatus,
  options: { connectorStatusId?: string; errorReason?: string } = {},
): CreateExternalContentDTO {
  return {
    platform,
    externalId: content.externalId,
    type: content.type as ExternalContentType,
    status,
    title: content.title,
    url: content.url,
    thumbnailUrl: content.thumbnailUrl,
    authorHandle: content.authorHandle,
    caption: content.caption,
    views: content.views ?? 0,
    likes: content.likes ?? 0,
    shares: content.shares ?? 0,
    publishedAt: content.publishedAt,
    errorReason: options.errorReason,
    raw: (content.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    connectorStatusId: options.connectorStatusId,
  };
}

// ------------------------------------------------------------------
// RSC-serializable shapes
// ------------------------------------------------------------------

/** Row shape consumed by the dashboard content table. */
export interface ExternalContentItemDTO {
  id: string;
  platform: ConnectorPlatform;
  externalId: string;
  type: ExternalContentType;
  status: ExternalContentStatus;
  title: string;
  url: string | null;
  thumbnailUrl: string | null;
  authorHandle: string | null;
  views: number;
  likes: number;
  shares: number;
  publishedAt: string | null;
  errorReason: string | null;
  createdAt: string;
}

export function toExternalContentDTO(content: ExternalContent): ExternalContentItemDTO {
  return {
    id: content.id,
    platform: content.platform,
    externalId: content.externalId,
    type: content.type,
    status: content.status,
    title: content.title,
    url: content.url,
    thumbnailUrl: content.thumbnailUrl,
    authorHandle: content.authorHandle,
    views: content.views,
    likes: content.likes,
    shares: content.shares,
    publishedAt: content.publishedAt ? content.publishedAt.toISOString() : null,
    errorReason: content.errorReason,
    createdAt: content.createdAt.toISOString(),
  };
}

/** Paginated result envelope for the dashboard table. */
export interface ExternalContentPageDTO {
  items: ExternalContentItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function toExternalContentPageDTO(
  items: ExternalContent[],
  page: number,
  pageSize: number,
  total: number,
): ExternalContentPageDTO {
  return {
    items: items.map(toExternalContentDTO),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** One connector card in the dashboard grid. */
export interface ConnectorStatusDTO {
  platform: ConnectorPlatform;
  /** Display name declared by the adapter ("Mock Connector"…). */
  name: string;
  /** `false` for the three placeholders (PR005). */
  implemented: boolean;
  state: ConnectorState;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  importedCount: number;
  duplicateCount: number;
  failedCount: number;
  syncCount: number;
  /** Derived: enabled AND last run succeeded. */
  active: boolean;
}

/**
 * Build a card DTO from the adapter metadata plus the (possibly missing)
 * persisted row. A platform that was never synced has no `ConnectorStatus`
 * row yet — it still renders, as IDLE with zeroed counters.
 */
export function toConnectorStatusDTO(
  descriptor: { platform: ConnectorPlatform; name: string; implemented: boolean },
  status: ConnectorStatus | null,
): ConnectorStatusDTO {
  const state: ConnectorState = status?.state ?? ("IDLE" as ConnectorState);
  const enabled = status?.enabled ?? false;
  return {
    platform: descriptor.platform,
    name: descriptor.name,
    implemented: descriptor.implemented,
    state,
    enabled,
    lastSyncAt: status?.lastSyncAt ? status.lastSyncAt.toISOString() : null,
    lastError: status?.lastError ?? null,
    importedCount: status?.importedCount ?? 0,
    duplicateCount: status?.duplicateCount ?? 0,
    failedCount: status?.failedCount ?? 0,
    syncCount: status?.syncCount ?? 0,
    active: enabled && state === "ACTIVE",
  };
}

/** KPI aggregates for the dashboard header. */
export interface ConnectorKpisDTO {
  /** Content rows with status IMPORTED. */
  imported: number;
  /** Content rows with status DUPLICATE. */
  duplicates: number;
  /** Content rows with status FAILED. */
  failed: number;
  /** Connectors that are enabled AND whose last run succeeded. */
  activeConnectors: number;
  /** How many connectors are registered in the factory (denominator). */
  totalConnectors: number;
}

/** Uniform result for server actions (success or field/form errors). */
export type ConnectorActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
