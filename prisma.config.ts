import path from "node:path";
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
 *   bug). The adapter value is present in the config object but the
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

// Build the config object. When isMigrationCommand() is true at process
// startup, engine and adapter are omitted so the native Rust query engine
// handles the command using the schema.prisma datasource URL directly —
// bypassing the OID 19 deserializer bug in the JS engine.
//
// The defineConfig() type in Prisma 6.19.3 is a discriminated union that
// does not accept `engine: "js" | undefined` or `adapter: ... | undefined`
// inline, so we assemble the object and cast it.
const config = {
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  experimental: { adapter: true },
  ...(isMigrationCommand()
    ? { engine: undefined as undefined, adapter: undefined as undefined }
    : { engine: "js" as const, adapter: cliAdapter }),
};

export default config as unknown as Parameters<typeof defineConfig>[0];
