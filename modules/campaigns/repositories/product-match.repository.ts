import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type {
  CreateProductMatchDTO,
  ProductMatchKpis,
  ProductMatchRow,
} from "../dto/product-match.dto";
import type { MatchListQuery } from "../validators/product-match.validator";

/**
 * Product Match repository — the ONLY place that talks to Prisma for the
 * `ProductMatch` model (PR005.1).
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope.
 *
 * FK OWNERSHIP: `createMatch` refuses to link a content or a product that
 * does not belong to the caller's tenant — a match between foreign
 * endpoints can never be created, even with a guessed id.
 *
 * `createProductMatchRepository(db)` is a factory so the tenant-safety of
 * every query can be unit-tested against an in-memory database (see
 * `tests/product-match-repository.test.ts`) without a real Postgres.
 */

/** The Prisma surface the product-match repository is allowed to touch. */
export type ProductMatchDatabase = Pick<
  PrismaClient,
  "productMatch" | "externalContent" | "product"
>;

/** Relations loaded on every read — the dashboard needs both endpoints. */
const MATCH_INCLUDE = {
  externalContent: true,
  product: true,
} satisfies Prisma.ProductMatchInclude;

/** Confidence ordering first (the dashboard's default sort), newest first as tiebreak. */
const MATCH_ORDER: Prisma.ProductMatchOrderByWithRelationInput[] = [
  { confidence: "desc" },
  { createdAt: "desc" },
];

export interface ProductMatchListResult {
  items: ProductMatchRow[];
  total: number;
}

export interface ProductMatchRepository {
  /**
   * Persist one match. Returns `null` (no write) when the content or the
   * product does not belong to the caller's tenant.
   */
  createMatch(organizationId: string, data: CreateProductMatchDTO): Promise<ProductMatchRow | null>;
  /** Paginated, searchable dashboard listing ordered by confidence. */
  listMatches(organizationId: string, query: MatchListQuery): Promise<ProductMatchListResult>;
  /** Every match of one external content, best confidence first. */
  findByContent(organizationId: string, externalContentId: string): Promise<ProductMatchRow[]>;
  /** Every match of one product, best confidence first. */
  findByProduct(organizationId: string, productId: string): Promise<ProductMatchRow[]>;
  /**
   * Promote a match to MANUAL with full confidence — the human word is
   * definitive. Returns `null` when the id does not exist in the tenant.
   */
  approveMatch(organizationId: string, matchId: string): Promise<ProductMatchRow | null>;
  /** Delete one match. Returns whether a tenant-scoped row was removed. */
  deleteMatch(organizationId: string, matchId: string): Promise<boolean>;
  /** KPI aggregates for the dashboard header. */
  kpis(organizationId: string): Promise<ProductMatchKpis>;
}

export function createProductMatchRepository(db: ProductMatchDatabase): ProductMatchRepository {
  return {
    async createMatch(organizationId, data) {
      // tenantWhere() asserts the scope — a blank tenant throws before any query.
      const scope = tenantWhere(organizationId);

      // Both endpoints must exist INSIDE the caller's tenant before any write.
      const [content, product] = await Promise.all([
        db.externalContent.findFirst({
          where: scopedWhere(organizationId, { id: data.externalContentId }),
        }),
        db.product.findFirst({ where: scopedWhere(organizationId, { id: data.productId }) }),
      ]);
      if (!content || !product) return null;

      return db.productMatch.create({
        data: {
          externalContentId: data.externalContentId,
          productId: data.productId,
          confidence: data.confidence,
          matchedBy: data.matchedBy,
          organizationId: scope.organizationId,
        },
        include: MATCH_INCLUDE,
      });
    },

    async listMatches(organizationId, query) {
      const filters: Prisma.ProductMatchWhereInput = {};
      if (query.search) {
        filters.OR = [
          { externalContent: { title: { contains: query.search, mode: "insensitive" } } },
          { externalContent: { externalId: { contains: query.search, mode: "insensitive" } } },
          { product: { name: { contains: query.search, mode: "insensitive" } } },
          { product: { slug: { contains: query.search, mode: "insensitive" } } },
        ];
      }

      // Tenant scope merged LAST — caller filters can never widen the boundary.
      const where = scopedWhere(organizationId, filters);

      const [items, total] = await Promise.all([
        db.productMatch.findMany({
          where,
          include: MATCH_INCLUDE,
          orderBy: MATCH_ORDER,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        db.productMatch.count({ where }),
      ]);
      return { items, total };
    },

    async findByContent(organizationId, externalContentId) {
      return db.productMatch.findMany({
        where: scopedWhere(organizationId, { externalContentId }),
        include: MATCH_INCLUDE,
        orderBy: MATCH_ORDER,
      });
    },

    async findByProduct(organizationId, productId) {
      return db.productMatch.findMany({
        where: scopedWhere(organizationId, { productId }),
        include: MATCH_INCLUDE,
        orderBy: MATCH_ORDER,
      });
    },

    async approveMatch(organizationId, matchId) {
      // updateMany is tenant-scoped: a foreign id matches zero rows (no leak).
      const { count } = await db.productMatch.updateMany({
        where: scopedWhere(organizationId, { id: matchId }),
        data: { matchedBy: "MANUAL", confidence: 1 },
      });
      if (count === 0) return null;
      return db.productMatch.findFirst({
        where: scopedWhere(organizationId, { id: matchId }),
        include: MATCH_INCLUDE,
      });
    },

    async deleteMatch(organizationId, matchId) {
      const { count } = await db.productMatch.deleteMany({
        where: scopedWhere(organizationId, { id: matchId }),
      });
      return count > 0;
    },

    async kpis(organizationId) {
      const where = tenantWhere(organizationId);

      const [grouped, aggregate, importedContents, matchedRows] = await Promise.all([
        db.productMatch.groupBy({ by: ["matchedBy"], where, _count: { _all: true } }),
        db.productMatch.aggregate({ where, _avg: { confidence: true } }),
        db.externalContent.count({ where }),
        db.productMatch.findMany({ where, select: { externalContentId: true } }),
      ]);

      const bySource = grouped.reduce<Record<string, number>>((result, row) => {
        result[row.matchedBy] = row._count._all;
        return result;
      }, {});
      const automatic = (bySource.AI ?? 0) + (bySource.RULE ?? 0);
      const manual = bySource.MANUAL ?? 0;
      const total = automatic + manual;
      const matchedContents = new Set(matchedRows.map((row) => row.externalContentId)).size;

      return {
        importedContents,
        totalMatches: total,
        automaticMatches: automatic,
        manualMatches: manual,
        matchedContents,
        averageConfidence: aggregate._avg.confidence ?? 0,
      };
    },
  };
}

/** Default singleton bound to the app's Prisma client. */
export const productMatchRepository = createProductMatchRepository(prisma);
