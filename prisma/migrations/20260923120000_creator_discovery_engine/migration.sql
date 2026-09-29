-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Creator Discovery Engine (PR003)
--
-- NOTES
-- -----
-- * `Creator` is RENAMED to `CreatorProfile` (data is preserved). The
--   PR000 stub becomes the PR003 CRM model: new columns (`source`, `niche`,
--   `avgViews`, `engagementRate`, `creatorScore`) arrive with safe
--   defaults, obsolete global uniques become tenant-scoped ones.
-- * `CreatorStatus` values are remapped in place (PROSPECT→NEW,
--   INVITED→CONTACTED, ACTIVE→ACTIVE, PAUSED→ARCHIVED) so no row is lost.
-- * New child models: `CreatorMetric` (daily snapshots) and `CreatorTag`
--   (labels) — both with the required denormalized `organizationId`.
-- * Purely additive for campaigns/messages/sales: the `creatorId` columns
--   keep pointing at the same (renamed) table; only the referenced type
--   changed in the Prisma schema.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "CreatorSource" AS ENUM ('MOCK', 'TIKTOK', 'INSTAGRAM', 'SHOPEE', 'MANUAL');

-- AlterEnum (values replaced in place — Prisma cannot ALTER enum values,
-- so the type is recreated and the column re-cast with an explicit map)
CREATE TYPE "CreatorStatus_new" AS ENUM ('NEW', 'QUALIFIED', 'CONTACTED', 'NEGOTIATING', 'ACTIVE', 'ARCHIVED');
ALTER TABLE "Creator" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Creator" ALTER COLUMN "status" TYPE "CreatorStatus_new" USING (
  CASE "status"
    WHEN 'PROSPECT' THEN 'NEW'::"CreatorStatus_new"
    WHEN 'INVITED'  THEN 'CONTACTED'::"CreatorStatus_new"
    WHEN 'ACTIVE'   THEN 'ACTIVE'::"CreatorStatus_new"
    WHEN 'PAUSED'   THEN 'ARCHIVED'::"CreatorStatus_new"
    ELSE 'NEW'::"CreatorStatus_new"
  END
);
ALTER TABLE "Creator" ALTER COLUMN "status" SET DEFAULT 'NEW';
DROP TYPE "CreatorStatus";
ALTER TYPE "CreatorStatus_new" RENAME TO "CreatorStatus";

-- RenameTable (the PR000 stub becomes the PR003 CRM model — data preserved)
ALTER TABLE "Creator" RENAME TO "CreatorProfile";
ALTER TABLE "CreatorProfile" RENAME CONSTRAINT "Creator_pkey" TO "CreatorProfile_pkey";
ALTER TABLE "CreatorProfile" RENAME CONSTRAINT "Creator_organizationId_fkey" TO "CreatorProfile_organizationId_fkey";

-- AddColumns (safe defaults — existing rows are backfilled, never dropped)
ALTER TABLE "CreatorProfile" ADD COLUMN "source" "CreatorSource" NOT NULL DEFAULT 'MOCK',
                            ADD COLUMN "niche" TEXT NOT NULL DEFAULT 'Moda',
                            ADD COLUMN "avgViews" INTEGER NOT NULL DEFAULT 0,
                            ADD COLUMN "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
                            ADD COLUMN "creatorScore" INTEGER NOT NULL DEFAULT 0;

-- Backfill: externalId is unknown for PR000 rows — keep NULL (MANUAL-like),
-- but mark the origin so discovery re-imports create fresh profiles.
UPDATE "CreatorProfile" SET "source" = 'MANUAL' WHERE "externalId" IS NULL;

-- DropIndexes / CreateIndexes (global uniques → tenant-scoped uniques)
DROP INDEX "Creator_handle_key";
DROP INDEX "Creator_email_key";
DROP INDEX "Creator_externalId_key";
DROP INDEX "Creator_status_idx";
DROP INDEX "Creator_organizationId_idx";

CREATE UNIQUE INDEX "CreatorProfile_organizationId_handle_key" ON "CreatorProfile"("organizationId", "handle");
CREATE UNIQUE INDEX "CreatorProfile_organizationId_source_externalId_key" ON "CreatorProfile"("organizationId", "source", "externalId");
CREATE UNIQUE INDEX "CreatorProfile_organizationId_email_key" ON "CreatorProfile"("organizationId", "email");
CREATE INDEX "CreatorProfile_status_idx" ON "CreatorProfile"("status");
CREATE INDEX "CreatorProfile_organizationId_idx" ON "CreatorProfile"("organizationId");
CREATE INDEX "CreatorProfile_organizationId_status_idx" ON "CreatorProfile"("organizationId", "status");
CREATE INDEX "CreatorProfile_organizationId_creatorScore_idx" ON "CreatorProfile"("organizationId", "creatorScore");
CREATE INDEX "CreatorProfile_organizationId_niche_idx" ON "CreatorProfile"("organizationId", "niche");

-- CreateTable (daily performance snapshots per creator)
CREATE TABLE "CreatorMetric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "creatorProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable (free-form labels per creator)
CREATE TABLE "CreatorTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "creatorProfileId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorMetric_creatorProfileId_date_key" ON "CreatorMetric"("creatorProfileId", "date");
CREATE INDEX "CreatorMetric_organizationId_idx" ON "CreatorMetric"("organizationId");
CREATE INDEX "CreatorMetric_organizationId_date_idx" ON "CreatorMetric"("organizationId", "date");

CREATE UNIQUE INDEX "CreatorTag_creatorProfileId_name_key" ON "CreatorTag"("creatorProfileId", "name");
CREATE INDEX "CreatorTag_organizationId_idx" ON "CreatorTag"("organizationId");
CREATE INDEX "CreatorTag_organizationId_name_idx" ON "CreatorTag"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "CreatorMetric" ADD CONSTRAINT "CreatorMetric_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorMetric" ADD CONSTRAINT "CreatorMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CreatorTag" ADD CONSTRAINT "CreatorTag_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreatorTag" ADD CONSTRAINT "CreatorTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
