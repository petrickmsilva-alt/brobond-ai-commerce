import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma CLI configuration (Prisma 6+).
 *
 * STRATEGY SPLIT (PR010.4.7, fixed in PR010.4.8):
 * ────────────────────────────────────────────────────────────────
 * RUNTIME (Next.js / Server Actions / API Routes):
 *   lib/prisma.ts  →  new PrismaPg()  →  JS engine
 *   NEVER touches prisma.config.ts — it is CLI-only.
 *
 * CLI (prisma generate / migrate / db push / studio):
 *   prisma.config.ts  →  native engine during migration commands
 *   (generate always uses native; migrate/db-push/studio use native
 *   when a migration-related command is detected).
 *
 * Rationale: Prisma 6.19.3's JS engine (@prisma/adapter-pg) cannot
 * deserialize PostgreSQL system type OID 19 ("name") during migration
 * setup (upstream prisma/prisma#27403). The adapter is correct and
 * required at runtime, but migrations must use the native Rust query
 * engine to bypass the deserializer bug.
 *
 * PR010.4.8 — WHY THE MIGRATION BRANCH MUST OMIT THE KEYS ENTIRELY:
 * `@prisma/config` validates the default export with an Effect schema
 * union. Spreading `{ engine: undefined, adapter: undefined }` creates
 * keys that are PRESENT with an undefined value — which the schema
 * rejects for the native-engine branch (only the literal `"js"` branch
 * accepts an `adapter`, and the native branch requires the keys to be
 * absent). The CLI then aborts with the misleading
 * `Failed to parse syntax of config file at "prisma.config.ts"`
 * (actually `parseDefaultExport` throwing `ConfigFileSyntaxError`),
 * BEFORE any migration work — breaking `prisma migrate deploy` locally,
 * on Render's preDeployCommand and in the CI smoke test. Building the
 * object through two complete literals keeps each branch's keys
 * exactly as its schema branch expects.
 */
const CLI_ARGS = process.argv.slice(2);

function isMigrationCommand(): boolean {
  return CLI_ARGS.some(
    (arg) =>
      arg === "migrate" ||
      arg.startsWith("migrate ") ||
      arg.includes(" migrate") ||
      arg === "db" ||
      arg.startsWith("db ") ||
      arg.includes(" db") ||
      arg === "studio",
  );
}

/**
 * Adapter provider for the CLI.
 *
 * - All non-migration CLI commands (validate, format, etc.) → PrismaPg
 *   adapter + `engine: "js"`, sharing the runtime path the app uses.
 * - Migration commands (migrate deploy / db push / studio) → native
 *   Rust engine: the `engine`/`adapter` keys are OMITTED so the config
 *   parses cleanly and the native engine (which ignores adapters)
 *   handles the command, bypassing the OID 19 deserializer bug.
 */
async function cliAdapter() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Prisma database commands.");
  }
  return new PrismaPg({ connectionString });
}

// Assemble the config as one of two COMPLETE literals — never by
// spreading `{ engine: undefined, ... }` (see the PR010.4.8 note above).
// The plain-object shape is exported directly; Prisma's config loader
// accepts it without `defineConfig`'s discriminated-union type.
const config = isMigrationCommand()
  ? {
      schema: path.join("prisma", "schema.prisma"),
      migrations: {
        seed: "tsx prisma/seed.ts",
      },
      experimental: { adapter: true },
    }
  : {
      schema: path.join("prisma", "schema.prisma"),
      migrations: {
        seed: "tsx prisma/seed.ts",
      },
      experimental: { adapter: true },
      engine: "js" as const,
      adapter: cliAdapter,
    };

export default config;
