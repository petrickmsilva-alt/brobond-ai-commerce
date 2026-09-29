-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Trend Hunter AI
-- PR002: TrendSnapshot, TrendKeyword, TrendCategory.
--
-- NOTES
-- -----
-- * Trend Hunter is the first Commercial Intelligence module. It stores,
--   classifies and prioritizes product trends per tenant.
-- * PR002 ships a MOCK collector only — no TikTok API, no scraping. The
--   `TrendCollector` interface (`modules/trends/hunter/collector.ts`) is
--   the plug-in point for real sources in a future PR.
-- * Every table carries a REQUIRED `organizationId` (NOT NULL + FK
--   `ON DELETE CASCADE`) — no trend record can exist without a tenant.
-- * `TrendKeyword` and `TrendCategory` are tenant-scoped UNIQUE
--   (`(organizationId, keyword)` / `(organizationId, name)`) so two
--   organizations may track the same keyword/category independently.
-- ------------------------------------------------------------------

-- CreateTable
CREATE TABLE "TrendSnapshot" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "trendScore" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendKeyword" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex — TrendSnapshot (dashboard sort/filter)
CREATE INDEX "TrendSnapshot_organizationId_idx" ON "TrendSnapshot"("organizationId");
CREATE INDEX "TrendSnapshot_organizationId_trendScore_idx" ON "TrendSnapshot"("organizationId", "trendScore");
CREATE INDEX "TrendSnapshot_organizationId_category_idx" ON "TrendSnapshot"("organizationId", "category");
CREATE INDEX "TrendSnapshot_organizationId_createdAt_idx" ON "TrendSnapshot"("organizationId", "createdAt");

-- CreateIndex — TrendKeyword (tenant-scoped unique + frequency ranking)
CREATE UNIQUE INDEX "TrendKeyword_organizationId_keyword_key" ON "TrendKeyword"("organizationId", "keyword");
CREATE INDEX "TrendKeyword_organizationId_frequency_idx" ON "TrendKeyword"("organizationId", "frequency");

-- CreateIndex — TrendCategory (tenant-scoped unique + score ranking)
CREATE UNIQUE INDEX "TrendCategory_organizationId_name_key" ON "TrendCategory"("organizationId", "name");
CREATE INDEX "TrendCategory_organizationId_score_idx" ON "TrendCategory"("organizationId", "score");

-- AddForeignKey
ALTER TABLE "TrendSnapshot" ADD CONSTRAINT "TrendSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrendKeyword" ADD CONSTRAINT "TrendKeyword_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrendCategory" ADD CONSTRAINT "TrendCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
