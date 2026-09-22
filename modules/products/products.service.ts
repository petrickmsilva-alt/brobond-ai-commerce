import "server-only";
import { prisma } from "@/lib/prisma";
import { assertSameTenant, tenantWhere, scopedWhere } from "@/lib/tenant";

/**
 * Products module — catalog data access.
 *
 * TENANT ISOLATION: every function takes `organizationId` as its first
 * argument and injects it into the `where` clause. No query may run without
 * an organization scope.
 */
export const productsService = {
  list(organizationId: string) {
    return prisma.product.findMany({
      where: tenantWhere(organizationId),
      orderBy: { createdAt: "desc" },
    });
  },

  /**
   * `slug` is globally unique, so the record is re-checked against the
   * caller's tenant and `null` is returned for foreign records (no leak).
   */
  async getBySlug(organizationId: string, slug: string) {
    const product = await prisma.product.findFirst({
      where: scopedWhere(organizationId, { slug }),
    });
    return assertSameTenant(product, organizationId);
  },

  async getById(organizationId: string, id: string) {
    const product = await prisma.product.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
    return assertSameTenant(product, organizationId);
  },

  count(organizationId: string) {
    return prisma.product.count({ where: tenantWhere(organizationId) });
  },
};
