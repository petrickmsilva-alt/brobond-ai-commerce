import type { Prisma } from "@prisma/client";
import { scopedWhere } from "@/lib/tenant";
import type { ProductListQuery } from "../validators/product.schema";

/**
 * Translate a validated dashboard query into a scoped Prisma `where`.
 *
 * Pure (type-only Prisma import) so the filter logic is unit-testable without
 * a database. The tenant scope is merged LAST via `scopedWhere`, so caller
 * filters can never widen or override the isolation boundary.
 */
export function buildListWhere(
  organizationId: string,
  query: ProductListQuery,
): Prisma.ProductWhereInput {
  const filters: Prisma.ProductWhereInput = {};

  if (query.search) {
    filters.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { slug: { contains: query.search, mode: "insensitive" } },
      { sku: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.status) filters.status = query.status;

  if (query.minMarginBps !== undefined || query.maxMarginBps !== undefined) {
    filters.marginBps = {
      ...(query.minMarginBps !== undefined ? { gte: query.minMarginBps } : {}),
      ...(query.maxMarginBps !== undefined ? { lte: query.maxMarginBps } : {}),
    };
  }
  if (query.minPriceCents !== undefined || query.maxPriceCents !== undefined) {
    filters.priceCents = {
      ...(query.minPriceCents !== undefined ? { gte: query.minPriceCents } : {}),
      ...(query.maxPriceCents !== undefined ? { lte: query.maxPriceCents } : {}),
    };
  }
  if (query.inStock === true) filters.stockQuantity = { gt: 0 };
  if (query.inStock === false) filters.stockQuantity = { lte: 0 };

  // Tenant scope merged LAST — caller filters can never widen the boundary.
  return scopedWhere(organizationId, filters);
}
