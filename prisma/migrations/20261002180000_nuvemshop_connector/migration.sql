-- Nuvemshop becomes a first-class omnichannel catalog and revenue provider.
-- Enum changes are additive, preserving every existing connector and sale.
ALTER TYPE "ConnectorPlatform" ADD VALUE 'NUVEMSHOP';
ALTER TYPE "ConnectorProvider" ADD VALUE 'NUVEMSHOP';
ALTER TYPE "SaleChannel" ADD VALUE 'NUVEMSHOP';

-- The provider product id, scoped by tenant, is the catalog idempotency key.
-- Product names and SKUs are mutable and therefore cannot safely deduplicate.
ALTER TABLE "Product" ADD COLUMN "nuvemshopProductId" TEXT;
CREATE UNIQUE INDEX "Product_organizationId_nuvemshopProductId_key"
  ON "Product"("organizationId", "nuvemshopProductId");
