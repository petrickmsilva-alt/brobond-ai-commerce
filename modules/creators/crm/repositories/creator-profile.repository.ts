import "server-only";
import type {
  CreatorMetric,
  CreatorProfile,
  CreatorSource,
  CreatorStatus,
  CreatorTag,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { CreatorStatusName } from "../../interfaces/creator.interface";
import { CONTACTED_STATUSES, CREATOR_STATUSES } from "../../interfaces/creator.interface";
import { PREMIUM_CREATOR_SCORE_THRESHOLD } from "../../discovery/scorer";
import type { CreatorListQuery } from "../validators/creator.validator";
import type {
  CreateCreatorDTO,
  DerivedCreatorMetricDTO,
  DiscoveryUpsertDTO,
} from "../dto/creator.dto";

/**
 * Creator repository — the ONLY place that talks to Prisma for the Creator
 * CRM models (CreatorProfile, CreatorMetric, CreatorTag).
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope.
 *
 * `createCreatorRepository(db)` is a factory so the tenant-safety of every
 * query can be unit-tested against an in-memory database (see
 * `tests/creator-repository.test.ts`) without a real Postgres.
 */

/** The Prisma surface the creators module is allowed to touch. */
export type CreatorDatabase = Pick<PrismaClient, "creatorProfile" | "creatorMetric" | "creatorTag">;

export interface TopCreatorsOptions {
  limit?: number;
  niche?: string;
  status?: CreatorStatus;
  minScore?: number;
}

export interface CreatorStats {
  totalCreators: number;
  /** Rounded mean of `creatorScore`, `null` when the base is empty. */
  averageScore: number | null;
  /** Profiles at or above `PREMIUM_CREATOR_SCORE_THRESHOLD`. */
  premiumCount: number;
  /** Profiles in any post-outreach stage (CONTACTED, NEGOTIATING, ACTIVE). */
  contactedCount: number;
  /** Row count per pipeline status (all six keys always present). */
  statusCounts: Record<CreatorStatusName, number>;
}

export interface PipelineOptions {
  /** Max cards rendered per column (totals still reflect every row). */
  limitPerColumn?: number;
}

export interface CreatorRepository {
  /** Create one profile (manual CRM path). */
  createCreator(organizationId: string, data: CreateCreatorDTO): Promise<CreatorProfile>;
  /** Scoped update — `updateMany` + re-read so a foreign id can never match. */
  updateCreator(
    organizationId: string,
    id: string,
    data: Prisma.CreatorProfileUncheckedUpdateInput,
  ): Promise<CreatorProfile | null>;
  /** Paginated, searchable, sortable dashboard listing. */
  listCreators(
    organizationId: string,
    query: CreatorListQuery,
  ): Promise<{ items: CreatorProfile[]; total: number }>;
  /** Highest-scoring creators (defaults to the top 10). */
  topCreators(organizationId: string, options?: TopCreatorsOptions): Promise<CreatorProfile[]>;
  /** Move a profile along the pipeline (transition guard lives above). */
  changeStatus(
    organizationId: string,
    id: string,
    status: CreatorStatus,
  ): Promise<CreatorProfile | null>;
  /** Tenant-checked read by id (foreign ids read as "not found"). */
  findById(organizationId: string, id: string): Promise<CreatorProfile | null>;
  /** KPI aggregates for the dashboard header + Kanban counters. */
  stats(organizationId: string): Promise<CreatorStats>;
  /** The six pipeline columns with their (optionally capped) cards. */
  pipeline(
    organizationId: string,
    options?: PipelineOptions,
  ): Promise<{ status: CreatorStatusName; count: number; items: CreatorProfile[] }[]>;
  /** Discovery dedupe upsert on (source, externalId) — never touches status. */
  upsertFromDiscovery(
    organizationId: string,
    data: DiscoveryUpsertDTO,
  ): Promise<{ creator: CreatorProfile; created: boolean }>;
  /** Upsert today's metric snapshot for a profile. */
  recordMetric(
    organizationId: string,
    creatorProfileId: string,
    data: DerivedCreatorMetricDTO,
  ): Promise<CreatorMetric | null>;
  /** Attach a tag to a profile (idempotent, tenant-checked). */
  addTag(
    organizationId: string,
    creatorProfileId: string,
    name: string,
  ): Promise<CreatorTag | null>;
}

export function createCreatorRepository(db: CreatorDatabase): CreatorRepository {
  return {
    async createCreator(organizationId, data) {
      return db.creatorProfile.create({
        data: { ...data, ...tenantWhere(organizationId) },
      });
    },

    async updateCreator(organizationId, id, data) {
      const { count } = await db.creatorProfile.updateMany({
        where: scopedWhere(organizationId, { id }),
        data,
      });
      if (count === 0) return null;
      return this.findById(organizationId, id);
    },

    async listCreators(organizationId, query) {
      const filters: Prisma.CreatorProfileWhereInput = {};
      if (query.search) {
        filters.OR = [
          { handle: { contains: query.search, mode: "insensitive" } },
          { displayName: { contains: query.search, mode: "insensitive" } },
        ];
      }
      if (query.status) filters.status = query.status;
      if (query.niche) filters.niche = query.niche;
      if (query.source) filters.source = query.source;

      // Tenant scope merged LAST — caller filters can never widen the boundary.
      const where = scopedWhere(organizationId, filters);

      const [items, total] = await Promise.all([
        db.creatorProfile.findMany({
          where,
          orderBy: { [query.sort]: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.creatorProfile.count({ where }),
      ]);
      return { items, total };
    },

    async topCreators(organizationId, options = {}) {
      const { limit = 10, niche, status, minScore } = options;
      const filters: Prisma.CreatorProfileWhereInput = {};
      if (niche) filters.niche = niche;
      if (status) filters.status = status;
      if (minScore !== undefined) filters.creatorScore = { gte: minScore };

      return db.creatorProfile.findMany({
        where: scopedWhere(organizationId, filters),
        orderBy: [{ creatorScore: "desc" }, { followers: "desc" }, { handle: "asc" }],
        take: limit,
      });
    },

    async changeStatus(organizationId, id, status) {
      const { count } = await db.creatorProfile.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: { status },
      });
      if (count === 0) return null;
      return this.findById(organizationId, id);
    },

    findById(organizationId, id) {
      return db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, { id }),
      });
    },

    async stats(organizationId) {
      const where = tenantWhere(organizationId);
      const [aggregate, premiumCount, contactedCount, groupByStatus] = await Promise.all([
        db.creatorProfile.aggregate({
          where,
          _count: true,
          _avg: { creatorScore: true },
        }),
        db.creatorProfile.count({
          where: scopedWhere(organizationId, {
            creatorScore: { gte: PREMIUM_CREATOR_SCORE_THRESHOLD },
          }),
        }),
        db.creatorProfile.count({
          where: scopedWhere(organizationId, { status: { in: [...CONTACTED_STATUSES] } }),
        }),
        db.creatorProfile.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
      ]);

      const statusCounts = Object.fromEntries(
        CREATOR_STATUSES.map((status) => [status, 0]),
      ) as Record<CreatorStatusName, number>;
      for (const group of groupByStatus) {
        statusCounts[group.status as CreatorStatusName] = group._count._all;
      }

      return {
        totalCreators: aggregate._count,
        averageScore:
          aggregate._avg.creatorScore === null ? null : Math.round(aggregate._avg.creatorScore),
        premiumCount,
        contactedCount,
        statusCounts,
      };
    },

    async pipeline(organizationId, options = {}) {
      const { limitPerColumn = 10 } = options;
      const where = tenantWhere(organizationId);

      const [groupByStatus, cards] = await Promise.all([
        db.creatorProfile.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
        }),
        db.creatorProfile.findMany({
          where,
          orderBy: [{ creatorScore: "desc" }, { handle: "asc" }],
          take: limitPerColumn * CREATOR_STATUSES.length,
        }),
      ]);

      const counts = Object.fromEntries(CREATOR_STATUSES.map((status) => [status, 0])) as Record<
        CreatorStatusName,
        number
      >;
      for (const group of groupByStatus) {
        counts[group.status as CreatorStatusName] = group._count._all;
      }

      return CREATOR_STATUSES.map((status) => ({
        status,
        count: counts[status]!,
        items: cards.filter((card) => card.status === status).slice(0, limitPerColumn),
      }));
    },

    async upsertFromDiscovery(organizationId, data) {
      // tenantWhere() asserts the scope — a blank tenant throws before any query.
      const existing = await db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, {
          source: data.source as CreatorSource,
          externalId: data.externalId,
        }),
      });

      if (existing) {
        // Re-import refreshes metrics + score only — the CRM status (and
        // every other manager-owned field) is deliberately preserved.
        const creator = await db.creatorProfile.update({
          where: { id: existing.id },
          data: {
            handle: data.handle,
            displayName: data.displayName,
            niche: data.niche,
            followers: data.followers,
            avgViews: data.avgViews,
            engagementRate: data.engagementRate,
            creatorScore: data.creatorScore,
          },
        });
        return { creator, created: false };
      }

      const creator = await db.creatorProfile.create({
        data: { ...data, ...tenantWhere(organizationId) },
      });
      return { creator, created: true };
    },

    async recordMetric(organizationId, creatorProfileId, data) {
      // Tenant check first — a foreign profile id must read as "not found".
      const profile = await db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, { id: creatorProfileId }),
        select: { id: true },
      });
      if (!profile) return null;

      return db.creatorMetric.upsert({
        where: { creatorProfileId_date: { creatorProfileId, date: data.date } },
        update: {
          views: data.views,
          likes: data.likes,
          shares: data.shares,
          followers: data.followers,
        },
        create: { ...data, creatorProfileId, ...tenantWhere(organizationId) },
      });
    },

    async addTag(organizationId, creatorProfileId, name) {
      // Tenant check first — a foreign profile id must read as "not found".
      const profile = await db.creatorProfile.findFirst({
        where: scopedWhere(organizationId, { id: creatorProfileId }),
        select: { id: true },
      });
      if (!profile) return null;

      const { organizationId: org } = tenantWhere(organizationId);
      return db.creatorTag.upsert({
        where: {
          creatorProfileId_name: { creatorProfileId, name },
        },
        update: {},
        create: { name, creatorProfileId, organizationId: org },
      });
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const creatorRepository = createCreatorRepository(prisma);
