import "server-only";

import { prisma } from "@/lib/prisma";
import type { TikTokDashboardDTO } from "./dto";

/** Read model for /dashboard/tiktok. Deliberately never selects token columns. */
export const tiktokDashboardService = {
  async getDashboard(organizationId: string): Promise<TikTokDashboardDTO> {
    const [accounts, synchronizedProducts, creators, logs] = await Promise.all([
      prisma.tikTokAccount.findMany({
        where: { organizationId },
        select: {
          id: true,
          shopId: true,
          shopName: true,
          sellerId: true,
          status: true,
          expiresAt: true,
          lastSync: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.product.count({ where: { organizationId, tiktokProductId: { not: null } } }),
      prisma.creatorProfile.count({ where: { organizationId, source: "TIKTOK" } }),
      prisma.auditLog.findMany({
        where: { organizationId, action: { startsWith: "TIKTOK_" } },
        select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const connected = accounts.filter((account) => account.status === "CONNECTED");
    const latestSync = accounts.reduce<Date | null>((latest, account) => {
      if (!account.lastSync) return latest;
      return !latest || account.lastSync > latest ? account.lastSync : latest;
    }, null);

    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        shopId: account.shopId,
        shopName: account.shopName,
        sellerId: account.sellerId,
        status: account.status,
        expiresAt: account.expiresAt?.toISOString() ?? null,
        lastSync: account.lastSync?.toISOString() ?? null,
        createdAt: account.createdAt.toISOString(),
      })),
      connectedAccounts: connected.length,
      synchronizedProducts,
      creators,
      lastSync: latestSync?.toISOString() ?? null,
      logs: logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  },
};
