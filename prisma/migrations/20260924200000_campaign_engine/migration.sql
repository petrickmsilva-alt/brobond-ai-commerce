CREATE TYPE "CampaignAudienceType" AS ENUM ('ALL', 'NICHE', 'SCORE', 'MANUAL');

ALTER TABLE "Campaign" ADD COLUMN "audienceType" "CampaignAudienceType" NOT NULL DEFAULT 'SCORE';

CREATE TABLE "CampaignAudience" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "matchScore" INTEGER NOT NULL,
  "recommended" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CampaignAudience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CampaignRule" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "minimumCreatorScore" INTEGER NOT NULL DEFAULT 0,
  "minimumTrendScore" INTEGER NOT NULL DEFAULT 0,
  "minimumProductMargin" INTEGER NOT NULL DEFAULT 0,
  "preferredNiche" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CampaignRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CampaignAudience_campaignId_creatorId_productId_key" ON "CampaignAudience"("campaignId", "creatorId", "productId");
CREATE INDEX "CampaignAudience_organizationId_matchScore_idx" ON "CampaignAudience"("organizationId", "matchScore");
CREATE INDEX "CampaignAudience_campaignId_recommended_idx" ON "CampaignAudience"("campaignId", "recommended");
CREATE INDEX "CampaignAudience_creatorId_idx" ON "CampaignAudience"("creatorId");
CREATE INDEX "CampaignAudience_productId_idx" ON "CampaignAudience"("productId");
CREATE UNIQUE INDEX "CampaignRule_campaignId_key" ON "CampaignRule"("campaignId");
CREATE INDEX "CampaignRule_organizationId_active_idx" ON "CampaignRule"("organizationId", "active");

ALTER TABLE "CampaignAudience" ADD CONSTRAINT "CampaignAudience_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAudience" ADD CONSTRAINT "CampaignAudience_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAudience" ADD CONSTRAINT "CampaignAudience_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignAudience" ADD CONSTRAINT "CampaignAudience_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CampaignRule" ADD CONSTRAINT "CampaignRule_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
