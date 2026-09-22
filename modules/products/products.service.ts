import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Products module — catalog data access.
 */
export const productsService = {
  list() {
    return prisma.product.findMany({ orderBy: { createdAt: "desc" } });
  },
  getBySlug(slug: string) {
    return prisma.product.findUnique({ where: { slug } });
  },
  count() {
    return prisma.product.count();
  },
};
