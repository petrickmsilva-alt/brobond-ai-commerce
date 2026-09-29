-- ------------------------------------------------------------------
-- PR011.1 — Sale Tenant FK + Rate Limiting
-- ------------------------------------------------------------------

-- Add organizationId to Sale (backfill first, then NOT NULL)
ALTER TABLE "Sale" ADD COLUMN "organizationId" TEXT;

-- Backfill from existing relations: prefer product, then creator, then campaign
UPDATE "Sale" SET "organizationId" = p."organizationId"
FROM "Product" p
WHERE "Sale"."productId" = p."id" AND "Sale"."organizationId" IS NULL;

UPDATE "Sale" SET "organizationId" = c."organizationId"
FROM "CreatorProfile" c
WHERE "Sale"."creatorId" = c."id" AND "Sale"."organizationId" IS NULL;

UPDATE "Sale" SET "organizationId" = ca."organizationId"
FROM "Campaign" ca
WHERE "Sale"."campaignId" = ca."id" AND "Sale"."organizationId" IS NULL;

-- Make NOT NULL (all rows should now have a value from backfill)
ALTER TABLE "Sale" ALTER COLUMN "organizationId" SET NOT NULL;

-- Foreign key to Organization (Cascade: deleting a tenant deletes its sales)
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS "Sale_organizationId_idx" ON "Sale"("organizationId");
CREATE INDEX IF NOT EXISTS "Sale_organizationId_status_idx" ON "Sale"("organizationId", "status");

-- ------------------------------------------------------------------
-- Rate Limiting table (PR011.1)
-- ------------------------------------------------------------------

CREATE TABLE "RateLimit" (
  "id"        TEXT    NOT NULL,
  "identifier" TEXT    NOT NULL,
  "type"      TEXT    NOT NULL DEFAULT 'login',
  "attempts"  INTEGER  NOT NULL DEFAULT 0,
  "lockedAt"  TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateLimit_identifier_type_key" ON "RateLimit"("identifier", "type");
CREATE INDEX "RateLimit_type_attempts_idx" ON "RateLimit"("type", "attempts");
