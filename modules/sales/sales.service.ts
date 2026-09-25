import "server-only";
import { prisma } from "@/lib/prisma";
import { SaleStatus, type Prisma } from "@prisma/client";
import { assertOrganizationId } from "@/lib/tenant";

/** Sales module — revenue data access. */
export const salesService = {
  list(organizationId: string) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.findMany({
      where: { organizationId: scope },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });
  },

  async totalRevenueCents(organizationId: string) {
    const scope = assertOrganizationId(organizationId);
    const result = await prisma.sale.aggregate({
      _sum: { amountCents: true },
      where: { AND: [{ organizationId: scope }, { status: SaleStatus.PAID }] },
    });
    return result._sum.amountCents ?? 0;
  },

  count(organizationId: string) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.count({ where: { organizationId: scope } });
  },
};
