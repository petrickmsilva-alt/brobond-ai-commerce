-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Connector Framework (PR005)
--
-- NOTES
-- -----
-- * Purely ADDITIVE: two new tables (`ConnectorStatus`, `ExternalContent`)
--   and four new enums. No existing table, column or row is touched, so the
--   migration is safe to deploy on a populated database.
-- * NO external API is integrated by this PR. The connectors are an
--   architecture only: MOCK is implemented, TIKTOK/INSTAGRAM/SHOPEE are
--   registered placeholders. No credential/token column exists on purpose —
--   a future PR adds a secret *reference*, never a raw secret.
-- * Both tables carry a REQUIRED `organizationId` (ON DELETE CASCADE): no
--   domain record may exist without an Organization.
-- * Dedupe contract: `(organizationId, platform, externalId)` is UNIQUE on
--   `ExternalContent`, which is what makes the "Duplicados" KPI meaningful.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ConnectorPlatform" AS ENUM ('MOCK', 'TIKTOK', 'INSTAGRAM', 'SHOPEE');

-- CreateEnum
CREATE TYPE "ConnectorState" AS ENUM ('IDLE', 'ACTIVE', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ExternalContentType" AS ENUM ('VIDEO', 'IMAGE', 'POST', 'PRODUCT', 'LIVE');

-- CreateEnum
CREATE TYPE "ExternalContentStatus" AS ENUM ('IMPORTED', 'DUPLICATE', 'FAILED');

-- CreateTable (per-tenant state of one platform connector)
CREATE TABLE "ConnectorStatus" (
    "id" TEXT NOT NULL,
    "platform" "ConnectorPlatform" NOT NULL,
    "state" "ConnectorState" NOT NULL DEFAULT 'IDLE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConnectorStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable (one imported item from an external platform)
CREATE TABLE "ExternalContent" (
    "id" TEXT NOT NULL,
    "platform" "ConnectorPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" "ExternalContentType" NOT NULL DEFAULT 'VIDEO',
    "status" "ExternalContentStatus" NOT NULL DEFAULT 'IMPORTED',
    "title" TEXT NOT NULL,
    "url" TEXT,
    "thumbnailUrl" TEXT,
    "authorHandle" TEXT,
    "caption" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "raw" JSONB,
    "connectorStatusId" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (one connector row per tenant per platform)
CREATE UNIQUE INDEX "ConnectorStatus_organizationId_platform_key" ON "ConnectorStatus"("organizationId", "platform");
CREATE INDEX "ConnectorStatus_organizationId_idx" ON "ConnectorStatus"("organizationId");
CREATE INDEX "ConnectorStatus_organizationId_state_idx" ON "ConnectorStatus"("organizationId", "state");
CREATE INDEX "ConnectorStatus_organizationId_enabled_idx" ON "ConnectorStatus"("organizationId", "enabled");

-- CreateIndex (dedupe key + dashboard access paths)
CREATE UNIQUE INDEX "ExternalContent_organizationId_platform_externalId_key" ON "ExternalContent"("organizationId", "platform", "externalId");
CREATE INDEX "ExternalContent_organizationId_idx" ON "ExternalContent"("organizationId");
CREATE INDEX "ExternalContent_organizationId_platform_idx" ON "ExternalContent"("organizationId", "platform");
CREATE INDEX "ExternalContent_organizationId_status_idx" ON "ExternalContent"("organizationId", "status");
CREATE INDEX "ExternalContent_organizationId_createdAt_idx" ON "ExternalContent"("organizationId", "createdAt");
CREATE INDEX "ExternalContent_connectorStatusId_idx" ON "ExternalContent"("connectorStatusId");

-- AddForeignKey
ALTER TABLE "ConnectorStatus" ADD CONSTRAINT "ConnectorStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalContent" ADD CONSTRAINT "ExternalContent_connectorStatusId_fkey" FOREIGN KEY ("connectorStatusId") REFERENCES "ConnectorStatus"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ExternalContent" ADD CONSTRAINT "ExternalContent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
