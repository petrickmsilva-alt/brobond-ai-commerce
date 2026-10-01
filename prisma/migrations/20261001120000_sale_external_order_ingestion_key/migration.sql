-- PR014 — Motor Financeiro Unificado (Hub Multicanal).
--
-- Idempotency key for webhook-driven sale ingestion: one Sale per
-- (tenant, channel, external order). Providers deliver webhooks
-- at-least-once; the ingestion worker upserts on this key so a replayed
-- Mercado Livre order or Mercado Pago payment never double-counts revenue.
--
-- `externalOrderId` is NULL for the own-store checkout (BROBOND), where
-- `reference` is already the canonical id — Postgres treats NULLs as
-- distinct inside unique indexes, so pre-existing rows are unaffected.
-- No writer ever set `externalOrderId` before this migration, so the index
-- can be created without a dedupe pass.

-- CreateIndex
CREATE UNIQUE INDEX "Sale_organizationId_channel_externalOrderId_key" ON "Sale"("organizationId", "channel", "externalOrderId");
