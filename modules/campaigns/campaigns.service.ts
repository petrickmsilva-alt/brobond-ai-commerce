import "server-only";
import { prisma } from "@/lib/prisma";
import { assertSameTenant, tenantWhere, scopedWhere } from "@/lib/tenant";

/**
 * Campaigns module — orchestration data access.
 *
 * TENANT ISOLATION: every function takes `organizationId` as its first
 * argument and injects it into the `where` clause. No query may run without
 * an organization scope.
 */
export const campaignsService = {
  list(organizationId: string) {
    return prisma.campaign.findMany({
      where: tenantWhere(organizationId),
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { creators: true, products: true } } },
    });
  },

  /**
   * `slug` is globally unique, so the record is re-checked against the
   * caller's tenant and `null` is returned for foreign records (no leak).
   */
  async getBySlug(organizationId: string, slug: string) {
    const campaign = await prisma.campaign.findFirst({
      where: scopedWhere(organizationId, { slug }),
    });
    return assertSameTenant(campaign, organizationId);
  },

  async getById(organizationId: string, id: string) {
    const campaign = await prisma.campaign.findFirst({
      where: scopedWhere(organizationId, { id }),
    });
    return assertSameTenant(campaign, organizationId);
  },

  count(organizationId: string) {
    return prisma.campaign.count({ where: tenantWhere(organizationId) });
  },
};
