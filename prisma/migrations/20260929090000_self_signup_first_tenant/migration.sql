-- PR010.4 — Self Signup & First Tenant Setup
--
-- Two things happen here, in this order:
--
--   1. `Organization` gains the first-tenant-setup columns written once by
--      `/signup`. Every one of them is nullable or has a default, so existing
--      rows keep their exact meaning and no backfill is required.
--
--   2. The `AccessRequest` table and its enum are dropped. The "Solicitar
--      acesso" flow no longer exists: a visitor now creates their own
--      Organization + ADMIN User + workspace defaults directly, so the queue
--      of inert leads has no reader left. Nothing in the authentication path
--      ever read this table, so dropping it cannot revoke anybody's access.

-- ------------------------------------------------------------------
-- 1. Organization — first tenant setup (additive, backwards compatible)
-- ------------------------------------------------------------------
ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "workspaceName" TEXT,
  ADD COLUMN IF NOT EXISTS "whatsapp" TEXT,
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'BRL',
  ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "selfServe" BOOLEAN NOT NULL DEFAULT false;

-- Pre-PR010.4 tenants were provisioned out-of-band and have already been in
-- use, so their onboarding is, by definition, behind them.
UPDATE "Organization"
   SET "workspaceName" = COALESCE("workspaceName", "name"),
       "onboardingCompletedAt" = COALESCE("onboardingCompletedAt", "createdAt")
 WHERE "workspaceName" IS NULL
    OR "onboardingCompletedAt" IS NULL;

-- ------------------------------------------------------------------
-- 2. AccessRequest — removed with the "Solicitar acesso" flow
-- ------------------------------------------------------------------
DROP INDEX IF EXISTS "AccessRequest_status_createdAt_idx";
DROP INDEX IF EXISTS "AccessRequest_email_idx";
DROP TABLE IF EXISTS "AccessRequest";
DROP TYPE IF EXISTS "AccessRequestStatus";
