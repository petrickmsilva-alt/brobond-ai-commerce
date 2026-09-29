import "server-only";

import { TikTokCryptoError, decryptTikTokSecret, encryptTikTokSecret } from "./crypto.service";
export {
  TikTokCryptoError,
  decodeEncryptionKey,
  decryptTikTokSecret,
  encryptTikTokSecret,
  hashOAuthState,
} from "./crypto.service";
import type { Prisma, PrismaClient, TikTokAccount, TikTokConnectionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedWhere, tenantWhere } from "@/lib/tenant";

export interface TikTokTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export type TikTokTokenDatabase = Pick<PrismaClient, "tikTokAccount">;

/**
 * Repository for TikTok account secrets. All account lookups are tenant scoped
 * unless the signed webhook's shop mapping is being resolved.
 */
export function createTikTokTokenRepository(db: TikTokTokenDatabase) {
  return {
    findById(organizationId: string, id: string) {
      return db.tikTokAccount.findFirst({ where: scopedWhere(organizationId, { id }) });
    },

    findConnected(organizationId: string) {
      return db.tikTokAccount.findMany({
        where: scopedWhere(organizationId, { status: "CONNECTED" as TikTokConnectionStatus }),
        orderBy: { createdAt: "asc" },
      });
    },

    findByShopId(shopId: string) {
      return db.tikTokAccount.findFirst({
        where: { shopId, status: "CONNECTED" as TikTokConnectionStatus },
      });
    },

    async upsertAuthorizedShop(
      organizationId: string,
      shop: {
        shopId: string;
        shopCipher: string;
        shopName?: string | null;
        sellerId?: string | null;
      },
      tokens: TikTokTokenSet,
    ) {
      const { organizationId: org } = tenantWhere(organizationId);
      return db.tikTokAccount.upsert({
        where: { organizationId_shopId: { organizationId: org, shopId: shop.shopId } },
        update: {
          shopCipher: shop.shopCipher,
          shopName: shop.shopName ?? null,
          sellerId: shop.sellerId ?? null,
          accessToken: encryptTikTokSecret(tokens.accessToken),
          refreshToken: encryptTikTokSecret(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          status: "CONNECTED" as TikTokConnectionStatus,
        },
        create: {
          organizationId: org,
          shopId: shop.shopId,
          shopCipher: shop.shopCipher,
          shopName: shop.shopName ?? null,
          sellerId: shop.sellerId ?? null,
          accessToken: encryptTikTokSecret(tokens.accessToken),
          refreshToken: encryptTikTokSecret(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          status: "CONNECTED" as TikTokConnectionStatus,
        },
      });
    },

    async saveRefreshedTokens(organizationId: string, id: string, tokens: TikTokTokenSet) {
      const { count } = await db.tikTokAccount.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: {
          accessToken: encryptTikTokSecret(tokens.accessToken),
          refreshToken: encryptTikTokSecret(tokens.refreshToken),
          expiresAt: tokens.expiresAt,
          status: "CONNECTED" as TikTokConnectionStatus,
        },
      });
      return count > 0;
    },

    async markExpired(organizationId: string, id: string) {
      await db.tikTokAccount.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: { status: "EXPIRED" as TikTokConnectionStatus },
      });
    },

    async disconnect(organizationId: string, id: string) {
      const { count } = await db.tikTokAccount.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: {
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          status: "DISCONNECTED" as TikTokConnectionStatus,
        },
      });
      return count > 0;
    },

    async markSynced(organizationId: string, id: string, at = new Date()) {
      await db.tikTokAccount.updateMany({
        where: scopedWhere(organizationId, { id }),
        data: { lastSync: at, status: "CONNECTED" as TikTokConnectionStatus },
      });
    },
  };
}

export const tiktokTokenRepository = createTikTokTokenRepository(prisma);

export function decryptAccountTokens(
  account: Pick<TikTokAccount, "accessToken" | "refreshToken">,
): {
  accessToken: string;
  refreshToken: string;
} {
  if (!account.accessToken || !account.refreshToken) {
    throw new TikTokCryptoError("TikTok account has no active encrypted credentials.");
  }
  return {
    accessToken: decryptTikTokSecret(account.accessToken),
    refreshToken: decryptTikTokSecret(account.refreshToken),
  };
}

/** Avoid accidental token-shaped data in audit/diagnostic metadata. */
export function redactTikTokSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return "[redacted]";
}

export type TikTokAuditMetadata = Prisma.InputJsonValue;
