import "server-only";
import { prisma } from "@/lib/prisma";
import { SaleStatus, type Prisma } from "@prisma/client";
import { assertOrganizationId } from "@/lib/tenant";

/**
 * Sales module — revenue data access.
 *
 * TENANT ISOLATION: `Sale` has no direct `organizationId` column — it inherits
 * tenant scope transitively through `product` / `creator` / `campaign`. The
 * scope is therefore expressed as a relational filter, but the rule is the
 * same: no query runs without an organization scope.
 *
 * Promoting `Sale` to a direct tenant FK is tracked for a later PR.
 */
function saleTenantWhere(organizationId: string): Prisma.SaleWhereInput {
  const scope = assertOrganizationId(organizationId);
  return {
    OR: [
      { product: { organizationId: scope } },
      { creator: { organizationId: scope } },
      { campaign: { organizationId: scope } },
    ],
  };
}

export const salesService = {
  list(organizationId: string) {
    return prisma.sale.findMany({
      where: saleTenantWhere(organizationId),
      orderBy: { occurredAt: "desc" },
      take: 50,
    });
  },

  async totalRevenueCents(organizationId: string) {
    const result = await prisma.sale.aggregate({
      _sum: { amountCents: true },
      where: { AND: [saleTenantWhere(organizationId), { status: SaleStatus.PAID }] },
    });
    return result._sum.amountCents ?? 0;
  },

  count(organizationId: string) {
    return prisma.sale.count({ where: saleTenantWhere(organizationId) });
  },
};
