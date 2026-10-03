-- AlterEnum (PR017 — TikTok Developers Sandbox):
-- A channel running against TikTok sandbox test shops is operationally
-- healthy, not "pending approval" and not an error. `SANDBOX_ACTIVE` models
-- that state explicitly. Application code still falls back to the functional
-- PENDING_APPROVAL state when this migration has not been applied yet, so the
-- rollout order between app and database is irrelevant.
ALTER TYPE "ConnectionStatus" ADD VALUE IF NOT EXISTS 'SANDBOX_ACTIVE';
ALTER TYPE "TikTokConnectionStatus" ADD VALUE IF NOT EXISTS 'SANDBOX_ACTIVE';
