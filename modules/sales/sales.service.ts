import "server-only";
import { prisma } from "@/lib/prisma";
import { SaleStatus } from "@prisma/client";

/**
 * Sales module — revenue data access.
 */
export const salesService = {
  list() {
    return prisma.sale.findMany({ orderBy: { occurredAt: "desc" }, take: 50 });
  },
  async totalRevenueCents() {
    const result = await prisma.sale.aggregate({
      _sum: { amountCents: true },
      where: { status: SaleStatus.PAID },
    });
    return result._sum.amountCents ?? 0;
  },
  count() {
    return prisma.sale.count();
  },
};
