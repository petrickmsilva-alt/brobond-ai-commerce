-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — Tenant hardening
-- PR000.2: make `organizationId` REQUIRED on every tenant-scoped model.
--
-- Models affected: User, Product, Creator, Campaign.
--
-- SAFETY CONTRACT
-- ---------------
-- This migration NEVER invents data. It does not create a fallback
-- Organization and it does not guess an owner for pre-existing rows.
--
-- If the database already holds rows with a NULL `organizationId`, the
-- migration aborts with an explicit, actionable error so that an operator
-- can assign the correct tenant first (data ownership is a business
-- decision, not a migration concern).
--
-- Remediation before re-running:
--     UPDATE "User"     SET "organizationId" = '<org id>' WHERE "organizationId" IS NULL;
--     UPDATE "Product"  SET "organizationId" = '<org id>' WHERE "organizationId" IS NULL;
--     UPDATE "Creator"  SET "organizationId" = '<org id>' WHERE "organizationId" IS NULL;
--     UPDATE "Campaign" SET "organizationId" = '<org id>' WHERE "organizationId" IS NULL;
--
-- On a fresh database (the expected state after `20260922000000_init_multitenant`)
-- every table is empty, so the guard is a no-op and the columns are simply
-- promoted to NOT NULL.
-- ------------------------------------------------------------------

-- Guard: abort if any tenant-scoped row is missing its Organization.
DO $$
DECLARE
  target      TEXT;
  targets     TEXT[] := ARRAY['User', 'Product', 'Creator', 'Campaign'];
  orphans     BIGINT;
  offenders   TEXT := '';
BEGIN
  FOREACH target IN ARRAY targets LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE "organizationId" IS NULL', target)
      INTO orphans;
    IF orphans > 0 THEN
      offenders := offenders || format('%s (%s row(s)); ', target, orphans);
    END IF;
  END LOOP;

  IF offenders <> '' THEN
    RAISE EXCEPTION
      'Cannot enforce NOT NULL on "organizationId": tenant-less rows found in %. Assign each row to an Organization and re-run this migration.',
      offenders
      USING ERRCODE = 'not_null_violation';
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Creator" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "organizationId" SET NOT NULL;
