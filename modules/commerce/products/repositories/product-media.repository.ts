import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

/**
 * ProductMedia repository — tenant-scoped data access.
 * Every function takes `organizationId` as its FIRST argument.
 */
export const productMediaRepository = {
  listByProduct(organizationId: string, productId: string) {
    return prisma.productMedia.findMany({
      where: scopedWhere(organizationId, { productId }),
      orderBy: [{ isPrimary: "desc" }, { position: "asc" }],
    });
  },

  findById(organizationId: string, id: string) {
    return prisma.productMedia.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
  },

  create(
    organizationId: string,
    data: Omit<Prisma.ProductMediaUncheckedCreateInput, "organizationId">,
  ) {
    return prisma.productMedia.create({
      data: { ...data, ...tenantWhere(organizationId) },
    });
  },

  async update(organizationId: string, id: string, data: Prisma.ProductMediaUncheckedUpdateInput) {
    const { count } = await prisma.productMedia.updateMany({
      where: scopedWhere(organizationId, { id }),
      data,
    });
    if (count === 0) return null;
    return this.findById(organizationId, id);
  },

  async delete(organizationId: string, id: string) {
    const { count } = await prisma.productMedia.deleteMany({
      where: scopedWhere(organizationId, { id }),
    });
    return count > 0;
  },

  /** Clear the primary flag on every media of a product (scoped). */
  clearPrimary(organizationId: string, productId: string) {
    return prisma.productMedia.updateMany({
      where: scopedWhere(organizationId, { productId }),
      data: { isPrimary: false },
    });
  },
};
