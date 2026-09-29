-- PR010 — Omnichannel Delivery Engine (official Meta APIs only:
-- Instagram Business Messaging + WhatsApp Business Cloud API).
CREATE TYPE "DeliveryChannel" AS ENUM ('INSTAGRAM', 'WHATSAPP');
CREATE TYPE "DeliveryStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');
CREATE TYPE "DeliveryAccountStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'EXPIRED', 'ERROR');

CREATE TABLE "DeliveryAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT,
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "DeliveryAccountStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryAccount_accountId_key" ON "DeliveryAccount"("accountId");
CREATE UNIQUE INDEX "DeliveryAccount_organizationId_channel_accountId_key" ON "DeliveryAccount"("organizationId", "channel", "accountId");
CREATE INDEX "DeliveryAccount_organizationId_channel_status_idx" ON "DeliveryAccount"("organizationId", "channel", "status");
ALTER TABLE "DeliveryAccount" ADD CONSTRAINT "DeliveryAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "providerMessageId" TEXT,
    "payload" JSONB NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DeliveryMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryMessage_organizationId_executionId_channel_recipientId_key" ON "DeliveryMessage"("organizationId", "executionId", "channel", "recipientId");
CREATE INDEX "DeliveryMessage_organizationId_status_idx" ON "DeliveryMessage"("organizationId", "status");
CREATE INDEX "DeliveryMessage_organizationId_channel_idx" ON "DeliveryMessage"("organizationId", "channel");
CREATE INDEX "DeliveryMessage_organizationId_providerMessageId_idx" ON "DeliveryMessage"("organizationId", "providerMessageId");
CREATE INDEX "DeliveryMessage_organizationId_executionId_idx" ON "DeliveryMessage"("organizationId", "executionId");
CREATE INDEX "DeliveryMessage_status_nextAttemptAt_idx" ON "DeliveryMessage"("status", "nextAttemptAt");
ALTER TABLE "DeliveryMessage" ADD CONSTRAINT "DeliveryMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DeliveryOAuthState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryOAuthState_stateHash_key" ON "DeliveryOAuthState"("stateHash");
CREATE INDEX "DeliveryOAuthState_organizationId_channel_expiresAt_idx" ON "DeliveryOAuthState"("organizationId", "channel", "expiresAt");
ALTER TABLE "DeliveryOAuthState" ADD CONSTRAINT "DeliveryOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
