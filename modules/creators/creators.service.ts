import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Creators module — roster data access.
 */
export const creatorsService = {
  list() {
    return prisma.creator.findMany({ orderBy: { followers: "desc" } });
  },
  getByHandle(handle: string) {
    return prisma.creator.findUnique({ where: { handle } });
  },
  count() {
    return prisma.creator.count();
  },
};
