import "server-only";
import type {
  ConnectorPlatform,
  ConnectorState,
  ConnectorStatus,
  ExternalContent,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { CreateExternalContentDTO } from "./connector.dto";
import type { ContentListQuery } from "./connector.validator";

/**
 * Connector repository — the ONLY place that talks to Prisma for the
 * connector models (`ConnectorStatus`, `ExternalContent`).
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope.
 *
 * `createConnectorRepository(db)` is a factory so the tenant-safety of every
 * query can be unit-tested against an in-memory database (see
 * `tests/connector-repository.test.ts`) without a real Postgres.
 */

/** The Prisma surface the connectors module is allowed to touch. */
export type ConnectorDatabase = Pick<PrismaClient, "connectorStatus" | "externalContent">;

export interface ConnectorKpis {
  imported: number;
  duplicates: number;
  failed: number;
  activeConnectors: number;
}

export interface ConnectorSyncCounters {
  imported: number;
  duplicates: number;
  failed: number;
}

export interface ConnectorRepository {
  /** All connector rows of a tenant (missing platforms are simply absent). */
  listStatuses(organizationId: string): Promise<ConnectorStatus[]>;
  /** One connector row, or `null` when the platform was never touched. */
  findStatus(organizationId: string, platform: ConnectorPlatform): Promise<ConnectorStatus | null>;
  /** Create the row on first touch, or return the existing one. */
  ensureStatus(organizationId: string, platform: ConnectorPlatform): Promise<ConnectorStatus>;
  /** Enable/disable a connector (ADMIN toggle). */
  setEnabled(
    organizationId: string,
    platform: ConnectorPlatform,
    enabled: boolean,
  ): Promise<ConnectorStatus>;
  /** Record the outcome of one sync run (state + counters + timestamp). */
  recordSyncResult(
    organizationId: string,
    platform: ConnectorPlatform,
    result: {
      state: ConnectorState;
      counters: ConnectorSyncCounters;
      lastError?: string | null;
      syncedAt?: Date;
    },
  ): Promise<ConnectorStatus>;
  /** Persist one imported/duplicate/failed content row. */
  createContent(organizationId: string, data: CreateExternalContentDTO): Promise<ExternalContent>;
  /** Tenant-checked dedupe lookup on `(platform, externalId)`. */
  findContentByExternalId(
    organizationId: string,
    platform: ConnectorPlatform,
    externalId: string,
  ): Promise<ExternalContent | null>;
  /** Refresh an already-imported row's engagement numbers (re-sync). */
  refreshContent(
    organizationId: string,
    id: string,
    data: Pick<CreateExternalContentDTO, "views" | "likes" | "shares" | "title">,
  ): Promise<ExternalContent | null>;
  /** Paginated, searchable, sortable dashboard listing. */
  listContent(
    organizationId: string,
    query: ContentListQuery,
  ): Promise<{ items: ExternalContent[]; total: number }>;
  /** KPI aggregates for the dashboard header. */
  kpis(organizationId: string): Promise<ConnectorKpis>;
}

export function createConnectorRepository(db: ConnectorDatabase): ConnectorRepository {
  return {
    async listStatuses(organizationId) {
      return db.connectorStatus.findMany({
        where: tenantWhere(organizationId),
        orderBy: { platform: "asc" },
      });
    },

    async findStatus(organizationId, platform) {
      return db.connectorStatus.findFirst({
        where: scopedWhere(organizationId, { platform }),
      });
    },

    async ensureStatus(organizationId, platform) {
      // tenantWhere() asserts the scope — a blank tenant throws before any query.
      const { organizationId: org } = tenantWhere(organizationId);
      return db.connectorStatus.upsert({
        where: { organizationId_platform: { organizationId: org, platform } },
        update: {},
        create: { platform, organizationId: org },
      });
    },

    async setEnabled(organizationId, platform, enabled) {
      const { organizationId: org } = tenantWhere(organizationId);
      // Disabling forces the DISABLED state; enabling returns a never-synced
      // connector to IDLE but must NOT erase an existing ERROR/ACTIVE state.
      const existing = await db.connectorStatus.findFirst({
        where: { organizationId: org, platform },
      });
      const state: ConnectorState = enabled
        ? existing && existing.state !== "DISABLED"
          ? existing.state
          : ("IDLE" as ConnectorState)
        : ("DISABLED" as ConnectorState);

      return db.connectorStatus.upsert({
        where: { organizationId_platform: { organizationId: org, platform } },
        update: { enabled, state },
        create: { platform, organizationId: org, enabled, state },
      });
    },

    async recordSyncResult(organizationId, platform, result) {
      const { organizationId: org } = tenantWhere(organizationId);
      const { counters } = result;
      return db.connectorStatus.upsert({
        where: { organizationId_platform: { organizationId: org, platform } },
        update: {
          state: result.state,
          lastSyncAt: result.syncedAt ?? new Date(),
          lastError: result.lastError ?? null,
          importedCount: { increment: counters.imported },
          duplicateCount: { increment: counters.duplicates },
          failedCount: { increment: counters.failed },
          syncCount: { increment: 1 },
        },
        create: {
          platform,
          organizationId: org,
          state: result.state,
          enabled: true,
          lastSyncAt: result.syncedAt ?? new Date(),
          lastError: result.lastError ?? null,
          importedCount: counters.imported,
          duplicateCount: counters.duplicates,
          failedCount: counters.failed,
          syncCount: 1,
        },
      });
    },

    async createContent(organizationId, data) {
      return db.externalContent.create({
        data: { ...data, ...tenantWhere(organizationId) },
      });
    },

    async findContentByExternalId(organizationId, platform, externalId) {
      return db.externalContent.findFirst({
        where: scopedWhere(organizationId, { platform, externalId }),
      });
    },

    async refreshContent(organizationId, id, data) {
      const { count } = await db.externalContent.updateMany({
        where: scopedWhere(organizationId, { id }),
        data,
      });
      if (count === 0) return null;
      return db.externalContent.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    async listContent(organizationId, query) {
      const filters: Prisma.ExternalContentWhereInput = {};
      if (query.search) {
        filters.OR = [
          { title: { contains: query.search, mode: "insensitive" } },
          { externalId: { contains: query.search, mode: "insensitive" } },
          { authorHandle: { contains: query.search, mode: "insensitive" } },
        ];
      }
      if (query.platform) filters.platform = query.platform;
      if (query.status) filters.status = query.status;
      if (query.type) filters.type = query.type;

      // Tenant scope merged LAST — caller filters can never widen the boundary.
      const where = scopedWhere(organizationId, filters);

      const [items, total] = await Promise.all([
        db.externalContent.findMany({
          where,
          orderBy: { [query.sort]: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.externalContent.count({ where }),
      ]);
      return { items, total };
    },

    async kpis(organizationId) {
      const where = tenantWhere(organizationId);
      const [grouped, statuses] = await Promise.all([
        db.externalContent.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
        db.connectorStatus.findMany({ where }),
      ]);

      const counts = grouped.reduce<Record<string, number>>((result, row) => {
        result[row.status] = row._count._all;
        return result;
      }, {});

      return {
        imported: counts.IMPORTED ?? 0,
        duplicates: counts.DUPLICATE ?? 0,
        failed: counts.FAILED ?? 0,
        // A connector counts as active only when the workspace enabled it
        // AND its last run succeeded — same predicate as `isConnectorActive`.
        activeConnectors: statuses.filter((status) => status.enabled && status.state === "ACTIVE")
          .length,
      };
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const connectorRepository = createConnectorRepository(prisma);
