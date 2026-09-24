-- ------------------------------------------------------------------
-- Brobond AI Commerce OS — PR010.4.7 HOTFIX (part 1 of 2)
-- Migration order repair: P3018 / relation "CreatorProfile" does not exist
--
-- THE BUG
-- -------
-- `20260922194600_outreach_ai_sales_pipeline` (PR004) adds
--
--   ALTER TABLE "OutreachMessage"
--     ADD CONSTRAINT "OutreachMessage_creatorId_fkey"
--     FOREIGN KEY ("creatorId") REFERENCES "CreatorProfile"("id") ...
--
-- but the table is still called "Creator" at that point in history: it is
-- only renamed to "CreatorProfile" by the LATER migration
-- `20260923120000_creator_discovery_engine` (PR003). On any database that
-- replays the history from zero, PR004 therefore aborts with
--
--   P3018 — ERROR: relation "CreatorProfile" does not exist
--
-- and every migration after it is never applied.
--
-- THE FIX (no already-applied migration is edited)
-- ------------------------------------------------
-- Two new migrations bracket the broken one:
--
--   20260922194500  (this file) "Creator"        -> "CreatorProfile"
--   20260922194600  (untouched) PR004 runs, the FK now resolves
--   20260922194700  (part 2)    "CreatorProfile" -> "Creator"
--
-- After part 2 the schema is bit-for-bit the pre-existing PR004 state
-- (only the table NAME is moved back and forth; indexes, constraints and
-- the primary key keep their original "Creator_*" names, so PR003 still
-- finds exactly what it expects and performs the real, permanent rename).
-- PostgreSQL rewires foreign keys by OID, so the FK created by PR004
-- automatically follows the table through both renames and ends up
-- pointing at "CreatorProfile" — identical to the schema Prisma expects.
--
-- IDEMPOTENT REPLAY
-- -----------------
-- Every statement is guarded: on a database that is already past PR003
-- (i.e. "CreatorProfile" exists in its final shape) this migration is a
-- no-op and simply records itself in `_prisma_migrations`.
-- ------------------------------------------------------------------

DO $$
DECLARE
  outreach_finished BOOLEAN := FALSE;
  leftover_table    TEXT;
  leftover_tables   TEXT[] := ARRAY['OutreachMessage', 'FollowUpSequence', 'MessageTemplate'];
  leftover_rows     BIGINT;
  populated         TEXT := '';
BEGIN
  -- --------------------------------------------------------------
  -- 1. Clean up a PARTIALLY applied 20260922194600 (P3009 recovery).
  --
  --    PostgreSQL runs each Prisma migration script inside an implicit
  --    transaction, so the failed PR004 normally leaves nothing behind.
  --    Some engines/operators replay statement-by-statement though, and
  --    PR004 is not idempotent (plain CREATE TYPE / CREATE TABLE), so a
  --    half-applied run would break the replay with "already exists".
  --
  --    Only EMPTY objects from a migration that never reached
  --    `finished_at` are removed. Nothing is ever deleted from
  --    `_prisma_migrations` itself.
  -- --------------------------------------------------------------
  IF to_regclass('"_prisma_migrations"') IS NOT NULL THEN
    EXECUTE $q$
      SELECT EXISTS (
        SELECT 1 FROM "_prisma_migrations"
        WHERE migration_name = '20260922194600_outreach_ai_sales_pipeline'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
      )
    $q$ INTO outreach_finished;
  END IF;

  IF NOT outreach_finished THEN
    FOREACH leftover_table IN ARRAY leftover_tables LOOP
      IF to_regclass(format('%I', leftover_table)) IS NOT NULL THEN
        EXECUTE format('SELECT count(*) FROM %I', leftover_table) INTO leftover_rows;
        IF leftover_rows > 0 THEN
          populated := populated || format('%s (%s row(s)); ', leftover_table, leftover_rows);
        END IF;
      END IF;
    END LOOP;

    IF populated <> '' THEN
      RAISE EXCEPTION
        'PR004 (20260922194600_outreach_ai_sales_pipeline) is not recorded as applied, but its tables already hold data: %. Refusing to drop them. Mark the migration as applied with "npx prisma migrate resolve --applied 20260922194600_outreach_ai_sales_pipeline" if that schema is genuinely in place.',
        populated;
    END IF;

    FOREACH leftover_table IN ARRAY leftover_tables LOOP
      IF to_regclass(format('%I', leftover_table)) IS NOT NULL THEN
        EXECUTE format('DROP TABLE %I CASCADE', leftover_table);
        RAISE NOTICE 'PR010.4.7: dropped empty leftover table "%" from the failed PR004 run.', leftover_table;
      END IF;
    END LOOP;

    DROP TYPE IF EXISTS "OutreachStatus";
    DROP TYPE IF EXISTS "TemplateType";
  END IF;

  -- --------------------------------------------------------------
  -- 2. Make "CreatorProfile" exist BEFORE PR004 references it.
  -- --------------------------------------------------------------
  IF to_regclass('"CreatorProfile"') IS NOT NULL THEN
    -- Already past PR003 (or already forward-renamed): nothing to do.
    RAISE NOTICE 'PR010.4.7: "CreatorProfile" already exists — forward rename skipped.';
  ELSIF to_regclass('"Creator"') IS NOT NULL THEN
    ALTER TABLE "Creator" RENAME TO "CreatorProfile";
    RAISE NOTICE 'PR010.4.7: renamed "Creator" -> "CreatorProfile" so PR004 can create its foreign key.';
  ELSE
    RAISE EXCEPTION
      'Neither "Creator" nor "CreatorProfile" exists. The migration history is incomplete: 20260922000000_init_multitenant must run first.';
  END IF;
END
$$;
