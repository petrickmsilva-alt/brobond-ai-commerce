-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Analytics & Attribution (PR008)
--
-- NOTES
-- -----
-- * Purely ADDITIVE: one new table (`AnalyticsSnapshot`). No existing
--   table, column, constraint or row is touched, so the migration is
--   safe to deploy on a populated database.
-- * `AnalyticsSnapshot` carries a REQUIRED `organizationId`
--   (ON DELETE CASCADE): no domain record may exist without an
--   Organization.
-- * UNIQUE (organizationId, from, to) — one materialized metrics
--   snapshot per (tenant, period bucket); recomputation upserts and
--   never duplicates.
-- * Snapshots are derived data only: every metric is recomputed at any
--   time from Sale / Product / CreatorProfile / Campaign /
--   AIGeneratedMessage rows of the same tenant. Deleting snapshots
--   loses nothing — the pipeline regenerates them.
-- ------------------------------------------------------------------

-- CreateTable
CREATE TABLE "AnalyticsSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "metrics" JSONB NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSnapshot_organizationId_from_to_key" ON "AnalyticsSnapshot"("organizationId", "from", "to");

-- CreateIndex
CREATE INDEX "AnalyticsSnapshot_organizationId_computedAt_idx" ON "AnalyticsSnapshot"("organizationId", "computedAt");

-- AddForeignKey
ALTER TABLE "AnalyticsSnapshot" ADD CONSTRAINT "AnalyticsSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
