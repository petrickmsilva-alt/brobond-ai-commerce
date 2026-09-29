-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Product Match Architecture (PR005.1)
--
-- NOTES
-- -----
-- * Purely ADDITIVE: one new table (`ProductMatch`) and one new enum
--   (`MatchSource`). No existing table, column or row is touched, so the
--   migration is safe to deploy on a populated database.
-- * Deterministic matching ONLY: no OpenAI, no computer vision, no
--   embeddings — `confidence` is always produced by the rules engine
--   (`modules/campaigns/matching/`), never accepted from a client.
-- * `ProductMatch` carries a REQUIRED `organizationId` (ON DELETE CASCADE):
--   no domain record may exist without an Organization.
-- * One row per content/product pair: `(externalContentId, productId)` is
--   UNIQUE — the same video may match several products and the same
--   product may be sold by several videos, but never twice the same pair.
-- * Deleting either endpoint (content or product) deletes the match
--   (ON DELETE CASCADE), the same contract as the campaign join tables.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "MatchSource" AS ENUM ('AI', 'MANUAL', 'RULE');

-- CreateTable (one content ⇄ product correspondence)
CREATE TABLE "ProductMatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalContentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchedBy" "MatchSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique content/product pair)
CREATE UNIQUE INDEX "ProductMatch_externalContentId_productId_key" ON "ProductMatch"("externalContentId", "productId");

-- CreateIndex (tenant scope + confidence ordering for the dashboard)
CREATE INDEX "ProductMatch_organizationId_idx" ON "ProductMatch"("organizationId");
CREATE INDEX "ProductMatch_confidence_idx" ON "ProductMatch"("confidence");

-- AddForeignKey
ALTER TABLE "ProductMatch" ADD CONSTRAINT "ProductMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMatch" ADD CONSTRAINT "ProductMatch_externalContentId_fkey" FOREIGN KEY ("externalContentId") REFERENCES "ExternalContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMatch" ADD CONSTRAINT "ProductMatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
