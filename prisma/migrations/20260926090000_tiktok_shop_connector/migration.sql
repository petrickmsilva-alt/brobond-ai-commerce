-- PR009 — TikTok Shop Connector
CREATE TYPE "TikTokConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR');

ALTER TABLE "Product" ADD COLUMN "tiktokProductId" TEXT;
CREATE UNIQUE INDEX "Product_organizationId_tiktokProductId_key" ON "Product"("organizationId", "tiktokProductId");

CREATE TABLE "TikTokAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopCipher" TEXT NOT NULL,
    "shopName" TEXT,
    "sellerId" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "TikTokConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSync" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TikTokAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TikTokAccount_organizationId_shopId_key" ON "TikTokAccount"("organizationId", "shopId");
CREATE UNIQUE INDEX "TikTokAccount_shopId_key" ON "TikTokAccount"("shopId");
CREATE INDEX "TikTokAccount_organizationId_status_idx" ON "TikTokAccount"("organizationId", "status");
ALTER TABLE "TikTokAccount" ADD CONSTRAINT "TikTokAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TikTokOAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TikTokOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TikTokOAuthState_stateHash_key" ON "TikTokOAuthState"("stateHash");
CREATE INDEX "TikTokOAuthState_organizationId_expiresAt_idx" ON "TikTokOAuthState"("organizationId", "expiresAt");
ALTER TABLE "TikTokOAuthState" ADD CONSTRAINT "TikTokOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "externalEventId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuditLog_organizationId_externalEventId_key" ON "AuditLog"("organizationId", "externalEventId");
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
CREATE INDEX "AuditLog_organizationId_action_idx" ON "AuditLog"("organizationId", "action");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
