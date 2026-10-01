-- ------------------------------------------------------------------
-- PR013 — Sales Channel Attribution (Hub Multicanal de Vendas)
-- ------------------------------------------------------------------
-- Adds a first-class "which platform was this sold on" column to Sale so
-- Orders and Analytics can split revenue by origin (Brobond direct store ×
-- Mercado Livre × Shopee × TikTok Shop × Mercado Pago × Instagram) instead
-- of inferring it indirectly. Mirrors ConnectorProvider 1:1 plus the
-- BROBOND value for the own-store checkout.

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('BROBOND', 'TIKTOK', 'INSTAGRAM', 'SHOPEE', 'MERCADOLIVRE', 'MERCADOPAGO');

-- AlterTable: every existing sale predates multi-channel sync and was sold
-- through the Brobond store — BROBOND is the correct, non-destructive default.
ALTER TABLE "Sale" ADD COLUMN "channel" "SaleChannel" NOT NULL DEFAULT 'BROBOND';
ALTER TABLE "Sale" ADD COLUMN "externalOrderId" TEXT;

-- Index for the Orders/Analytics channel breakdown queries.
CREATE INDEX "Sale_organizationId_channel_idx" ON "Sale"("organizationId", "channel");
