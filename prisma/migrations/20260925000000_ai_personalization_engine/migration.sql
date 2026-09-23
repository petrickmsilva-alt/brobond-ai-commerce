-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — AI Personalization Engine (PR007)
--
-- NOTES
-- -----
-- * Purely ADDITIVE: one new enum (`AiMessageTone`) and one new table
--   (`AIGeneratedMessage`). No existing table, column or row is touched,
--   so the migration is safe to deploy on a populated database.
-- * PR007 generates and versions commercial content ONLY — it never sends
--   a message. Delivery remains the responsibility of the Outreach AI
--   outbox (`OutreachMessage`, PR004), which is untouched by this table.
-- * `AIGeneratedMessage` carries a REQUIRED `organizationId`
--   (ON DELETE CASCADE): no domain record may exist without an
--   Organization.
-- * Cache contract: `(organizationId, contextHash)` is UNIQUE — the same
--   (creator + product + campaign + promptVersion) tuple is never
--   regenerated (see `modules/ai/personalization/message.service.ts`).
-- * `creatorUserId` (the team member who triggered the generation) is
--   nullable with ON DELETE SET NULL so the audit trail survives user
--   deletion; `creatorProfileId`/`productId`/`campaignId` cascade with
--   their parent record, matching the existing OutreachMessage contract.
-- ------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "AiMessageTone" AS ENUM ('FRIENDLY', 'PREMIUM', 'LUXURY', 'STREET', 'FITNESS');

-- CreateTable
CREATE TABLE "AIGeneratedMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "creatorUserId" TEXT,
    "creatorProfileId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tone" "AiMessageTone" NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIGeneratedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (cache contract — see notes above)
CREATE UNIQUE INDEX "AIGeneratedMessage_organizationId_contextHash_key" ON "AIGeneratedMessage"("organizationId", "contextHash");

-- CreateIndex
CREATE INDEX "AIGeneratedMessage_organizationId_createdAt_idx" ON "AIGeneratedMessage"("organizationId", "createdAt");
CREATE INDEX "AIGeneratedMessage_organizationId_tone_idx" ON "AIGeneratedMessage"("organizationId", "tone");
CREATE INDEX "AIGeneratedMessage_creatorProfileId_idx" ON "AIGeneratedMessage"("creatorProfileId");
CREATE INDEX "AIGeneratedMessage_productId_idx" ON "AIGeneratedMessage"("productId");
CREATE INDEX "AIGeneratedMessage_campaignId_idx" ON "AIGeneratedMessage"("campaignId");

-- AddForeignKey
ALTER TABLE "AIGeneratedMessage" ADD CONSTRAINT "AIGeneratedMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneratedMessage" ADD CONSTRAINT "AIGeneratedMessage_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneratedMessage" ADD CONSTRAINT "AIGeneratedMessage_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneratedMessage" ADD CONSTRAINT "AIGeneratedMessage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIGeneratedMessage" ADD CONSTRAINT "AIGeneratedMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
