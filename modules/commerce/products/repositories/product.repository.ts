import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";
import type { ProductListQuery } from "../validators/product.schema";
import { buildListWhere } from "./product-list-where";

/**
 * Product repository — the ONLY place that talks to Prisma for the Product
 * aggregate root.
 *
 * TENANT ISOLATION CONTRACT: every function takes `organizationId` as its
 * FIRST argument and builds its `where` through `tenantWhere`/`scopedWhere`,
 * so no query can ever run without an organization scope.
 */

const listInclude = { _count: { select: { variants: true } } } satisfies Prisma.ProductInclude;

const detailInclude = {
  media: { orderBy: [{ isPrimary: "desc" }, { position: "asc" }] },
  variants: { orderBy: { position: "asc" } },
  costs: { orderBy: { effectiveFrom: "desc" } },
  metrics: { orderBy: { date: "desc" }, take: 30 },
} satisfies Prisma.ProductInclude;

export { buildListWhere };

export const productRepository = {
  async page(organizationId: string, query: ProductListQuery) {
    const where = buildListWhere(organizationId, query);
    const [items, total] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        include: listInclude,
        orderBy: { [query.sort]: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.product.count({ where }),
    ]);
    return { items, total };
  },

  findById(organizationId: string, id: string) {
    return prisma.product.findFirst({
      where: scopedWhere(organizationId, { id }),
      include: detailInclude,
    });
  },

  findBySlug(organizationId: string, slug: string) {
    return prisma.product.findFirst({
      where: scopedWhere(organizationId, { slug }),
      include: detailInclude,
    });
  },

  async slugExists(organizationId: string, slug: string, excludeId?: string) {
    const found = await prisma.product.findFirst({
      where: scopedWhere(organizationId, {
        slug,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      }),
      select: { id: true },
    });
    return found !== null;
  },

  create(organizationId: string, data: Omit<Prisma.ProductUncheckedCreateInput, "organizationId">) {
    return prisma.product.create({
      data: { ...data, ...tenantWhere(organizationId) },
    });
  },

  /** Scoped update: `updateMany` + re-read so a foreign id can never match. */
  async update(organizationId: string, id: string, data: Prisma.ProductUncheckedUpdateInput) {
    const { count } = await prisma.product.updateMany({
      where: scopedWhere(organizationId, { id }),
      data,
    });
    if (count === 0) return null;
    return this.findById(organizationId, id);
  },

  async delete(organizationId: string, id: string) {
    const { count } = await prisma.product.deleteMany({
      where: scopedWhere(organizationId, { id }),
    });
    return count > 0;
  },

  count(organizationId: string) {
    return prisma.product.count({ where: tenantWhere(organizationId) });
  },
};
