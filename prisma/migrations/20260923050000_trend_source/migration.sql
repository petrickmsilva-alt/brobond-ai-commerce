-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Multi-Source Data Architecture
-- PR002.1: TrendSource enum + TrendSnapshot.source.
--
-- NOTES
-- -----
-- * Purely ADDITIVE: `source` is a new NOT NULL column defaulting to
--   'MOCK', so every snapshot created before PR002.1 is retroactively
--   classified as mock-sourced. No existing row or column is touched.
-- * MANUAL is reserved for snapshots created through the dashboard form —
--   it deliberately has NO collector (`getCollector` throws for it).
-- * Real collectors (TikTok / Shopee / Instagram) are placeholders behind
--   `getCollector()` (`modules/trends/hunter/collector.factory.ts`) and
--   will be implemented in PR003+.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "TrendSource" AS ENUM ('MOCK', 'TIKTOK', 'SHOPEE', 'INSTAGRAM', 'MANUAL');

-- AlterTable
ALTER TABLE "TrendSnapshot" ADD COLUMN "source" "TrendSource" NOT NULL DEFAULT 'MOCK';

-- CreateIndex
CREATE INDEX "TrendSnapshot_organizationId_source_idx" ON "TrendSnapshot"("organizationId", "source");
