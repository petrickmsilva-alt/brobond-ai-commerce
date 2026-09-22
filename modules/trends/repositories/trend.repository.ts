import "server-only";
import type {
  Prisma,
  PrismaClient,
  TrendCategory,
  TrendKeyword,
  TrendSnapshot,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { CreateTrendDTO } from "../dto/create-trend.dto";
import type { TrendListQuery } from "../validators/trend.validator";

/**
 * Trend repository — the ONLY place that talks to Prisma for the Trend
 * Hunter models (TrendSnapshot, TrendKeyword, TrendCategory).
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope.
 *
 * `createTrendRepository(db)` is a factory so the tenant-safety of every
 * query can be unit-tested against an in-memory database (see
 * `tests/trend-repository.test.ts`) without a real Postgres.
 */

/** The Prisma surface the trends module is allowed to touch. */
export type TrendDatabase = Pick<PrismaClient, "trendSnapshot" | "trendKeyword" | "trendCategory">;

export interface TopTrendsOptions {
  limit?: number;
  category?: string;
  minScore?: number;
}

export interface FindKeywordsOptions {
  search?: string;
  limit?: number;
}

export interface TrendStats {
  totalSnapshots: number;
  maxScore: number | null;
  keywordCount: number;
  categoryCount: number;
  lastCollectedAt: Date | null;
}

export interface TrendRepository {
  /** Persist one scored trend as a snapshot (always tenant-scoped). */
  createSnapshot(organizationId: string, data: CreateTrendDTO): Promise<TrendSnapshot>;
  /** Paginated, searchable, sortable dashboard listing. */
  listSnapshots(
    organizationId: string,
    query: TrendListQuery,
  ): Promise<{ items: TrendSnapshot[]; total: number }>;
  /** Highest-scoring trends (defaults to the top 10). */
  topTrends(organizationId: string, options?: TopTrendsOptions): Promise<TrendSnapshot[]>;
  /** Aggregated keyword ranking (by frequency). */
  findKeywords(organizationId: string, options?: FindKeywordsOptions): Promise<TrendKeyword[]>;
  /** Materialized categories (by score). */
  findCategories(organizationId: string): Promise<TrendCategory[]>;
  /** Create/increment the frequency of a keyword (tenant-scoped unique). */
  upsertKeyword(organizationId: string, keyword: string, increment?: number): Promise<TrendKeyword>;
  /** Create/refresh the score of a category (tenant-scoped unique). */
  upsertCategory(organizationId: string, name: string, score: number): Promise<TrendCategory>;
  /** KPI aggregates for the dashboard header. */
  stats(organizationId: string): Promise<TrendStats>;
}

export function createTrendRepository(db: TrendDatabase): TrendRepository {
  return {
    async createSnapshot(organizationId, data) {
      return db.trendSnapshot.create({
        data: { ...data, ...tenantWhere(organizationId) },
      });
    },

    async listSnapshots(organizationId, query) {
      const filters: Prisma.TrendSnapshotWhereInput = {};
      if (query.search) {
        filters.keyword = { contains: query.search, mode: "insensitive" };
      }
      if (query.category) filters.category = query.category;

      // Tenant scope merged LAST — caller filters can never widen the boundary.
      const where = scopedWhere(organizationId, filters);

      const [items, total] = await Promise.all([
        db.trendSnapshot.findMany({
          where,
          orderBy: { [query.sort]: query.order },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.trendSnapshot.count({ where }),
      ]);
      return { items, total };
    },

    async topTrends(organizationId, options = {}) {
      const { limit = 10, category, minScore } = options;
      const filters: Prisma.TrendSnapshotWhereInput = {};
      if (category) filters.category = category;
      if (minScore !== undefined) filters.trendScore = { gte: minScore };

      return db.trendSnapshot.findMany({
        where: scopedWhere(organizationId, filters),
        orderBy: [{ trendScore: "desc" }, { views: "desc" }, { keyword: "asc" }],
        take: limit,
      });
    },

    async findKeywords(organizationId, options = {}) {
      const { search, limit = 30 } = options;
      const filters: Prisma.TrendKeywordWhereInput = {};
      if (search) {
        filters.keyword = { contains: search, mode: "insensitive" };
      }

      return db.trendKeyword.findMany({
        where: scopedWhere(organizationId, filters),
        orderBy: [{ frequency: "desc" }, { keyword: "asc" }],
        take: limit,
      });
    },

    async findCategories(organizationId) {
      return db.trendCategory.findMany({
        where: tenantWhere(organizationId),
        orderBy: [{ score: "desc" }, { name: "asc" }],
      });
    },

    async upsertKeyword(organizationId, keyword, increment = 1) {
      // tenantWhere() asserts the scope — a blank tenant throws before any query.
      const { organizationId: org } = tenantWhere(organizationId);
      return db.trendKeyword.upsert({
        where: { organizationId_keyword: { organizationId: org, keyword } },
        update: { frequency: { increment } },
        create: { keyword, frequency: increment, organizationId: org },
      });
    },

    async upsertCategory(organizationId, name, score) {
      const { organizationId: org } = tenantWhere(organizationId);
      return db.trendCategory.upsert({
        where: { organizationId_name: { organizationId: org, name } },
        update: { score },
        create: { name, score, organizationId: org },
      });
    },

    async stats(organizationId) {
      const where = tenantWhere(organizationId);
      const [aggregate, keywordCount, categoryCount] = await Promise.all([
        db.trendSnapshot.aggregate({
          where,
          _count: true,
          _max: { trendScore: true, createdAt: true },
        }),
        db.trendKeyword.count({ where }),
        db.trendCategory.count({ where }),
      ]);

      return {
        totalSnapshots: aggregate._count,
        maxScore: aggregate._max.trendScore ?? null,
        keywordCount,
        categoryCount,
        lastCollectedAt: aggregate._max.createdAt ?? null,
      };
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const trendRepository = createTrendRepository(prisma);
