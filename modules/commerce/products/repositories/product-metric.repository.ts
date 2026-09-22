import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

/**
 * ProductMetric repository — tenant-scoped data access.
 * Every function takes `organizationId` as its FIRST argument.
 */
export const productMetricRepository = {
  listByProduct(organizationId: string, productId: string, take = 30) {
    return prisma.productMetric.findMany({
      where: scopedWhere(organizationId, { productId }),
      orderBy: { date: "desc" },
      take,
    });
  },

  /**
   * Idempotent daily upsert keyed by `(productId, date)`.
   * The product's tenant is verified by the service before calling this.
   */
  upsert(
    organizationId: string,
    productId: string,
    date: Date,
    data: Omit<Prisma.ProductMetricUncheckedCreateInput, "organizationId" | "productId" | "date">,
  ) {
    return prisma.productMetric.upsert({
      where: { productId_date: { productId, date } },
      create: { ...data, productId, date, ...tenantWhere(organizationId) },
      update: data,
    });
  },

  async delete(organizationId: string, id: string) {
    const { count } = await prisma.productMetric.deleteMany({
      where: scopedWhere(organizationId, { id }),
    });
    return count > 0;
  },
};
