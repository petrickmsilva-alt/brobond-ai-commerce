import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

/**
 * ProductCost repository — tenant-scoped data access.
 * Every function takes `organizationId` as its FIRST argument.
 */
export const productCostRepository = {
  listByProduct(organizationId: string, productId: string) {
    return prisma.productCost.findMany({
      where: scopedWhere(organizationId, { productId }),
      orderBy: { effectiveFrom: "desc" },
    });
  },

  /** Most recent cost snapshot for a product (scoped), or `null`. */
  findCurrent(organizationId: string, productId: string) {
    return prisma.productCost.findFirst({
      where: scopedWhere(organizationId, { productId }),
      orderBy: { effectiveFrom: "desc" },
    });
  },

  findById(organizationId: string, id: string) {
    return prisma.productCost.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
  },

  create(
    organizationId: string,
    data: Omit<Prisma.ProductCostUncheckedCreateInput, "organizationId">,
  ) {
    return prisma.productCost.create({
      data: { ...data, ...tenantWhere(organizationId) },
    });
  },

  async delete(organizationId: string, id: string) {
    const { count } = await prisma.productCost.deleteMany({
      where: scopedWhere(organizationId, { id }),
    });
    return count > 0;
  },
};
