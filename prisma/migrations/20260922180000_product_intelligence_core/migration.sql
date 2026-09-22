-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Product Intelligence Core
-- PR001: ProductMedia, ProductVariant, ProductCost, ProductMetric,
--        stock/cost/margin columns on Product, tenant-scoped uniqueness.
--
-- NOTES
-- -----
-- * `Product.slug` and `Product.sku` move from GLOBAL unique to
--   TENANT-SCOPED unique (`(organizationId, slug)` / `(organizationId, sku)`),
--   so two organizations can reuse the same slug/SKU.
-- * `marginBps` stores gross margin in basis points (3550 = 35.50%) and
--   `currentCostCents` mirrors the latest ProductCost total — denormalized so
--   the dashboard can sort/filter by margin at the database level.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "ProductMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable: Product — stock + denormalized pricing snapshot
ALTER TABLE "Product" ADD COLUMN "stockQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "currentCostCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "marginBps" INTEGER NOT NULL DEFAULT 0;

-- Uniqueness: global → tenant-scoped
DROP INDEX "Product_slug_key";
DROP INDEX "Product_sku_key";
CREATE UNIQUE INDEX "Product_organizationId_slug_key" ON "Product"("organizationId", "slug");
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");

-- Dashboard sort/filter indexes
CREATE INDEX "Product_organizationId_status_idx" ON "Product"("organizationId", "status");
CREATE INDEX "Product_organizationId_marginBps_idx" ON "Product"("organizationId", "marginBps");
CREATE INDEX "Product_organizationId_priceCents_idx" ON "Product"("organizationId", "priceCents");

-- CreateTable
CREATE TABLE "ProductMedia" (
    "id" TEXT NOT NULL,
    "type" "ProductMediaType" NOT NULL DEFAULT 'IMAGE',
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "priceCents" INTEGER,
    "costCents" INTEGER,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "attributes" JSONB,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCost" (
    "id" TEXT NOT NULL,
    "unitCents" INTEGER NOT NULL DEFAULT 0,
    "freightCents" INTEGER NOT NULL DEFAULT 0,
    "packagingCents" INTEGER NOT NULL DEFAULT 0,
    "feesCents" INTEGER NOT NULL DEFAULT 0,
    "otherCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "note" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMetric" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "unitsSold" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "productId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductMedia_productId_idx" ON "ProductMedia"("productId");
CREATE INDEX "ProductMedia_organizationId_idx" ON "ProductMedia"("organizationId");

CREATE UNIQUE INDEX "ProductVariant_organizationId_sku_key" ON "ProductVariant"("organizationId", "sku");
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");
CREATE INDEX "ProductVariant_organizationId_idx" ON "ProductVariant"("organizationId");

CREATE INDEX "ProductCost_productId_effectiveFrom_idx" ON "ProductCost"("productId", "effectiveFrom");
CREATE INDEX "ProductCost_organizationId_idx" ON "ProductCost"("organizationId");

CREATE UNIQUE INDEX "ProductMetric_productId_date_key" ON "ProductMetric"("productId", "date");
CREATE INDEX "ProductMetric_organizationId_date_idx" ON "ProductMetric"("organizationId", "date");

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductMetric" ADD CONSTRAINT "ProductMetric_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMetric" ADD CONSTRAINT "ProductMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
