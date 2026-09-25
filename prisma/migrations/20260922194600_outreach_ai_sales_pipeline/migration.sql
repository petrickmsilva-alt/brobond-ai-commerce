-- PR004 — Outreach AI & Sales Pipeline
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'SENT', 'FAILED', 'CANCELLED');
CREATE TYPE "TemplateType" AS ENUM ('FIRST_CONTACT', 'FOLLOW_UP', 'NEGOTIATION', 'REENGAGEMENT');

CREATE TABLE "MessageTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "TemplateType" NOT NULL,
  "content" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutreachMessage" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
  "generatedText" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpSequence" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "daysAfter" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "templateId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTemplate_organizationId_name_key" ON "MessageTemplate"("organizationId", "name");
CREATE INDEX "MessageTemplate_organizationId_type_idx" ON "MessageTemplate"("organizationId", "type");
CREATE INDEX "OutreachMessage_organizationId_status_idx" ON "OutreachMessage"("organizationId", "status");
CREATE INDEX "OutreachMessage_organizationId_scheduledFor_idx" ON "OutreachMessage"("organizationId", "scheduledFor");
CREATE INDEX "OutreachMessage_creatorId_idx" ON "OutreachMessage"("creatorId");
CREATE INDEX "OutreachMessage_productId_idx" ON "OutreachMessage"("productId");
CREATE INDEX "OutreachMessage_campaignId_idx" ON "OutreachMessage"("campaignId");
CREATE INDEX "OutreachMessage_templateId_idx" ON "OutreachMessage"("templateId");
CREATE UNIQUE INDEX "FollowUpSequence_organizationId_name_key" ON "FollowUpSequence"("organizationId", "name");
CREATE INDEX "FollowUpSequence_organizationId_active_daysAfter_idx" ON "FollowUpSequence"("organizationId", "active", "daysAfter");
CREATE INDEX "FollowUpSequence_templateId_idx" ON "FollowUpSequence"("templateId");

ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- NOTE: at this point in migration history the creators table is still named
-- "Creator"; it is renamed to "CreatorProfile" in
-- 20260923120000_creator_discovery_engine. PostgreSQL automatically keeps this
-- foreign key pointing at the table across the rename, so the constraint must
-- reference "Creator" here or `prisma migrate deploy` fails on a fresh database
-- ("relation \"CreatorProfile\" does not exist"), which blocks every later
-- migration — including 20260929090000_self_signup_first_tenant.
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
