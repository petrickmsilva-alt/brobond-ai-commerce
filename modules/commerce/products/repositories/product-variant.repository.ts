import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

/**
 * ProductVariant repository — tenant-scoped data access.
 * Every function takes `organizationId` as its FIRST argument.
 */
export const productVariantRepository = {
  listByProduct(organizationId: string, productId: string) {
    return prisma.productVariant.findMany({
      where: scopedWhere(organizationId, { productId }),
      orderBy: { position: "asc" },
    });
  },

  findById(organizationId: string, id: string) {
    return prisma.productVariant.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
  },

  create(
    organizationId: string,
    data: Omit<Prisma.ProductVariantUncheckedCreateInput, "organizationId">,
  ) {
    return prisma.productVariant.create({
      data: { ...data, ...tenantWhere(organizationId) },
    });
  },

  async update(
    organizationId: string,
    id: string,
    data: Prisma.ProductVariantUncheckedUpdateInput,
  ) {
    const { count } = await prisma.productVariant.updateMany({
      where: scopedWhere(organizationId, { id }),
      data,
    });
    if (count === 0) return null;
    return this.findById(organizationId, id);
  },

  async delete(organizationId: string, id: string) {
    const { count } = await prisma.productVariant.deleteMany({
      where: scopedWhere(organizationId, { id }),
    });
    return count > 0;
  },

  /** Sum of variant stock for a product (scoped). */
  async totalStock(organizationId: string, productId: string) {
    const result = await prisma.productVariant.aggregate({
      where: scopedWhere(organizationId, { productId, isActive: true }),
      _sum: { stockQuantity: true },
    });
    return result._sum.stockQuantity ?? 0;
  },
};
