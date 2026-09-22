import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Campaigns module — orchestration data access.
 */
export const campaignsService = {
  list() {
    return prisma.campaign.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { creators: true, products: true } } },
    });
  },
  getBySlug(slug: string) {
    return prisma.campaign.findUnique({ where: { slug } });
  },
  count() {
    return prisma.campaign.count();
  },
};
