-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — PR010.4.7 HOTFIX (part 2 of 2)
-- Migration order repair: P3018 / relation "CreatorProfile" does not exist
--
-- Part 1 (`20260922194500_creator_profile_forward_rename`) renamed
-- "Creator" to "CreatorProfile" so that PR004
-- (`20260922194600_outreach_ai_sales_pipeline`) could create
-- "OutreachMessage_creatorId_fkey".
--
-- PR003 (`20260923120000_creator_discovery_engine`) is the migration that
-- owns the REAL rename: it re-types "CreatorStatus", renames the table,
-- renames "Creator_pkey"/"Creator_organizationId_fkey", drops the global
-- "Creator_*" indexes and adds the PR003 columns. That migration is
-- replayed verbatim (it must NOT be edited), so the table has to be
-- called "Creator" again when it runs.
--
-- This migration therefore restores the pre-PR004 name. The foreign key
-- created by PR004 follows the table automatically (PostgreSQL stores it
-- by OID), and PR003 then performs the permanent rename — so the final
-- schema is exactly the one `prisma/schema.prisma` describes:
--
--   OutreachMessage.creatorId -> CreatorProfile.id
--
-- IDEMPOTENT REPLAY
-- -----------------
-- The rename back only happens when the table is still in its pre-PR003
-- shape (no "source" column). On a database that already ran PR003 this
-- migration is a no-op.
-- ------------------------------------------------------------------

DO $$
DECLARE
  pr003_applied BOOLEAN;
BEGIN
  IF to_regclass('"CreatorProfile"') IS NULL THEN
    -- "Creator" was never forward-renamed (nothing to restore).
    RAISE NOTICE 'PR010.4.7: "CreatorProfile" not present — restore skipped.';
    RETURN;
  END IF;

  IF to_regclass('"Creator"') IS NOT NULL THEN
    RAISE NOTICE 'PR010.4.7: "Creator" already present — restore skipped.';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'CreatorProfile'
      AND column_name = 'source'
  ) INTO pr003_applied;

  IF pr003_applied THEN
    -- 20260923120000_creator_discovery_engine already ran: "CreatorProfile"
    -- is the final, permanent name. Never rename it back.
    RAISE NOTICE 'PR010.4.7: PR003 already applied — "CreatorProfile" kept as is.';
    RETURN;
  END IF;

  ALTER TABLE "CreatorProfile" RENAME TO "Creator";
  RAISE NOTICE 'PR010.4.7: renamed "CreatorProfile" -> "Creator" so PR003 can perform the permanent rename.';
END
$$;
