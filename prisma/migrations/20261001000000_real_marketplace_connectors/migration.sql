-- AlterEnum: PR012 adds the two new real marketplace platforms to the
-- connector framework enum (ExternalContent rows imported by Mercado Livre
-- and Mercado Pago syncs).
ALTER TYPE "ConnectorPlatform" ADD VALUE 'MERCADOLIVRE';
ALTER TYPE "ConnectorPlatform" ADD VALUE 'MERCADOPAGO';

-- CreateEnum
CREATE TYPE "ConnectorProvider" AS ENUM ('TIKTOK', 'INSTAGRAM', 'SHOPEE', 'MERCADOLIVRE', 'MERCADOPAGO');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'EXPIRED', 'ERROR');

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "shopId" TEXT,
    "shopName" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "clientSecret" TEXT,
    "publicKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "syncCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorOAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "ConnectorProvider" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectorId" TEXT,
    "provider" "ConnectorProvider" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "topic" TEXT,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connector_organizationId_provider_key" ON "Connector"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "Connector_organizationId_status_idx" ON "Connector"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Connector_provider_shopId_idx" ON "Connector"("provider", "shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorOAuthState_stateHash_key" ON "ConnectorOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "ConnectorOAuthState_organizationId_provider_expiresAt_idx" ON "ConnectorOAuthState"("organizationId", "provider", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConnectorEvent_organizationId_provider_externalEventId_key" ON "ConnectorEvent"("organizationId", "provider", "externalEventId");

-- CreateIndex
CREATE INDEX "ConnectorEvent_organizationId_provider_createdAt_idx" ON "ConnectorEvent"("organizationId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "ConnectorEvent_connectorId_idx" ON "ConnectorEvent"("connectorId");

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorOAuthState" ADD CONSTRAINT "ConnectorOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorEvent" ADD CONSTRAINT "ConnectorEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorEvent" ADD CONSTRAINT "ConnectorEvent_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "Connector"("id") ON DELETE SET NULL ON UPDATE CASCADE;
