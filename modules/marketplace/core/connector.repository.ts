import "server-only";

import type {
  ConnectionStatus,
  Connector,
  ConnectorEvent,
  ConnectorProvider,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

/**
 * Marketplace connector repository (PR012) — the ONLY place that talks to
 * Prisma for the unified connector models (`Connector`, `ConnectorOAuthState`,
 * `ConnectorEvent`).
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope. The single
 * exception is `findByShopId`, used by inbound webhooks that arrive without
 * a tenant: it resolves exactly one candidate row and the CALLER must then
 * re-scope every subsequent query to that row's `organizationId`.
 *
 * `createMarketplaceRepository(db)` is a factory so the tenant-safety of
 * every query can be unit-tested against an in-memory database without a
 * real Postgres — same convention as the PR005 connector repository.
 */

/** The Prisma surface the marketplace module is allowed to touch. */
export type MarketplaceDatabase = Pick<
  PrismaClient,
  "connector" | "connectorOAuthState" | "connectorEvent" | "auditLog"
>;

/** Encrypted credential payload persisted on a connection upsert. */
export interface ConnectorCredentialsPayload {
  accessToken?: string | null;
  refreshToken?: string | null;
  clientSecret?: string | null;
  publicKey?: string | null;
  expiresAt?: Date | null;
  shopId?: string | null;
  shopName?: string | null;
  metadata?: Prisma.InputJsonValue;
}

export interface MarketplaceSyncCounters {
  imported: number;
  duplicated: number;
  failed: number;
}

export interface MarketplaceRepository {
  /** All connection rows of a tenant (missing providers are simply absent). */
  list(organizationId: string): Promise<Connector[]>;
  /** One connection row, or `null` when the provider was never connected. */
  findByProvider(organizationId: string, provider: ConnectorProvider): Promise<Connector | null>;
  /** Create/update the connection of one provider inside one tenant. */
  upsertConnection(
    organizationId: string,
    provider: ConnectorProvider,
    data: ConnectorCredentialsPayload & { status: ConnectionStatus },
  ): Promise<Connector>;
  /** Persist rotated/refreshed tokens without touching counters. */
  saveTokens(
    organizationId: string,
    id: string,
    tokens: { accessToken: string; refreshToken?: string | null; expiresAt: Date | null },
  ): Promise<Connector | null>;
  /** Transition the connection status (and optional sanitized error). */
  setStatus(
    organizationId: string,
    provider: ConnectorProvider,
    status: ConnectionStatus,
    lastError?: string | null,
  ): Promise<Connector | null>;
  /** Record the outcome of one sync run (status + counters + timestamp). */
  recordSyncResult(
    organizationId: string,
    provider: ConnectorProvider,
    result: {
      status: ConnectionStatus;
      counters: MarketplaceSyncCounters;
      lastError?: string | null;
      syncedAt?: Date;
    },
  ): Promise<Connector | null>;
  /** Revoke a connection: wipes every ciphertext and marks DISCONNECTED. */
  clearCredentials(organizationId: string, provider: ConnectorProvider): Promise<Connector | null>;
  /**
   * Webhook tenant resolution — NOT tenant-scoped by design. The caller MUST
   * treat the returned row's `organizationId` as the only trusted scope.
   */
  findByShopId(provider: ConnectorProvider, shopId: string): Promise<Connector | null>;
  /** Has this provider event already been processed? (idempotency probe). */
  hasEvent(
    organizationId: string,
    provider: ConnectorProvider,
    externalEventId: string,
  ): Promise<boolean>;
  /** Persist one webhook event (idempotent on the unique delivery key). */
  recordEvent(
    organizationId: string,
    event: {
      provider: ConnectorProvider;
      externalEventId: string;
      connectorId?: string | null;
      topic?: string | null;
      payload?: Prisma.InputJsonValue;
    },
  ): Promise<ConnectorEvent | null>;
  /** Stamp an event as processed. */
  markEventProcessed(
    organizationId: string,
    provider: ConnectorProvider,
    externalEventId: string,
  ): Promise<void>;
}

export function createMarketplaceRepository(db: MarketplaceDatabase): MarketplaceRepository {
  return {
    async list(organizationId) {
      return db.connector.findMany({
        where: tenantWhere(organizationId),
        orderBy: { provider: "asc" },
      });
    },

    async findByProvider(organizationId, provider) {
      return db.connector.findFirst({
        where: scopedWhere(organizationId, { provider }),
      });
    },

    async upsertConnection(organizationId, provider, data) {
      const { organizationId: org } = tenantWhere(organizationId);
      const { status, ...credentials } = data;
      return db.connector.upsert({
        where: { organizationId_provider: { organizationId: org, provider } },
        update: { ...credentials, status, lastError: null },
        create: { provider, organizationId: org, status, ...credentials },
      });
    },

    async saveTokens(organizationId, id, tokens) {
      const { count } = await db.connector.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: {
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken !== undefined ? { refreshToken: tokens.refreshToken } : {}),
          expiresAt: tokens.expiresAt,
          status: "CONNECTED",
          lastError: null,
        },
      });
      if (count === 0) return null;
      return db.connector.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    async setStatus(organizationId, provider, status, lastError = null) {
      const { count } = await db.connector.updateMany({
        where: scopedWhere(organizationId, { provider }),
        data: { status, lastError },
      });
      if (count === 0) return null;
      return db.connector.findFirst({ where: scopedWhere(organizationId, { provider }) });
    },

    async recordSyncResult(organizationId, provider, result) {
      const { counters } = result;
      const syncedAt = result.syncedAt ?? new Date();
      const { count } = await db.connector.updateMany({
        where: scopedWhere(organizationId, { provider }),
        data: {
          status: result.status,
          lastSyncAt: syncedAt,
          lastError: result.lastError ?? null,
          importedCount: { increment: counters.imported },
          duplicatedCount: { increment: counters.duplicated },
          failedCount: { increment: counters.failed },
          syncCount: { increment: 1 },
        },
      });
      if (count === 0) return null;
      return db.connector.findFirst({ where: scopedWhere(organizationId, { provider }) });
    },

    async clearCredentials(organizationId, provider) {
      const { count } = await db.connector.updateMany({
        where: scopedWhere(organizationId, { provider }),
        data: {
          status: "DISCONNECTED",
          accessToken: null,
          refreshToken: null,
          clientSecret: null,
          publicKey: null,
          expiresAt: null,
          shopId: null,
          shopName: null,
          lastError: null,
        },
      });
      if (count === 0) return null;
      return db.connector.findFirst({ where: scopedWhere(organizationId, { provider }) });
    },

    async findByShopId(provider, shopId) {
      return db.connector.findFirst({ where: { provider, shopId } });
    },

    async hasEvent(organizationId, provider, externalEventId) {
      const existing = await db.connectorEvent.findFirst({
        where: scopedWhere(organizationId, { provider, externalEventId }),
        select: { id: true },
      });
      return existing !== null;
    },

    async recordEvent(organizationId, event) {
      const { organizationId: org } = tenantWhere(organizationId);
      // Upsert on the unique delivery key: a replayed at-least-once delivery
      // updates the stored payload instead of creating a second row.
      return db.connectorEvent.upsert({
        where: {
          organizationId_provider_externalEventId: {
            organizationId: org,
            provider: event.provider,
            externalEventId: event.externalEventId,
          },
        },
        update: { payload: event.payload },
        create: {
          organizationId: org,
          provider: event.provider,
          externalEventId: event.externalEventId,
          connectorId: event.connectorId ?? null,
          topic: event.topic ?? null,
          payload: event.payload,
        },
      });
    },

    async markEventProcessed(organizationId, provider, externalEventId) {
      await db.connectorEvent.updateMany({
        where: scopedWhere(organizationId, { provider, externalEventId }),
        data: { processedAt: new Date() },
      });
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const marketplaceRepository = createMarketplaceRepository(prisma);
