-- TikTok Seller Center review is an expected connection lifecycle state, not
-- an application error. PostgreSQL enum values are append-only here so this
-- migration is safe for existing Connector rows.
ALTER TYPE "ConnectionStatus" ADD VALUE 'PENDING_APPROVAL';

-- Shopee catalog products need their own provider identity. SKU cannot serve
-- as an idempotency key because sellers may omit or later change it.
ALTER TABLE "Product" ADD COLUMN "shopeeProductId" TEXT;
CREATE UNIQUE INDEX "Product_organizationId_shopeeProductId_key"
  ON "Product"("organizationId", "shopeeProductId");
