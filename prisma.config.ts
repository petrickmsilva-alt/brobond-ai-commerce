import path from "node:path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma CLI configuration (Prisma 6+).
 *
 * STRATEGY SPLIT (PR010.4.7):
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
 * - Migration commands (migrate deploy / db push / studio) → native
 *   engine, no adapter (bypasses the OID 19 JS-engine deserializer
 *   bug). The adapter value is still supplied (type contract) but the
 *   native Rust engine ignores it.
 * - All other CLI commands (validate, format, etc.) → PrismaPg adapter
 *   so they share the same runtime path the app uses.
 */
async function cliAdapter() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for Prisma database commands.");
  }
  return new PrismaPg({ connectionString });
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  experimental: { adapter: true },
  engine: isMigrationCommand() ? undefined : "js",
  adapter: cliAdapter,
});
