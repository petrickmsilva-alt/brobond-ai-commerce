import "server-only";
import { prisma } from "@/lib/prisma";
import { assertSameTenant, tenantWhere, scopedWhere } from "@/lib/tenant";

/**
 * Creators module — roster data access.
 *
 * TENANT ISOLATION: every function takes `organizationId` as its first
 * argument and injects it into the `where` clause. No query may run without
 * an organization scope.
 */
export const creatorsService = {
  list(organizationId: string) {
    return prisma.creator.findMany({
      where: tenantWhere(organizationId),
      orderBy: { followers: "desc" },
    });
  },

  /**
   * `handle` is globally unique, so the record is re-checked against the
   * caller's tenant and `null` is returned for foreign records (no leak).
   */
  async getByHandle(organizationId: string, handle: string) {
    const creator = await prisma.creator.findFirst({
      where: scopedWhere(organizationId, { handle }),
    });
    return assertSameTenant(creator, organizationId);
  },

  async getById(organizationId: string, id: string) {
    const creator = await prisma.creator.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
    return assertSameTenant(creator, organizationId);
  },

  count(organizationId: string) {
    return prisma.creator.count({ where: tenantWhere(organizationId) });
  },
};
