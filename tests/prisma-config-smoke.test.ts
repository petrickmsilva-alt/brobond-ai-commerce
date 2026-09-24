import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import configImport from "../prisma.config";

/**
 * Prisma CLI config smoke test.
 *
 * The config object is built at module-load time from `process.argv`. When
 * vitest imports this module, `process.argv` does NOT contain a Prisma
 * migration command, so `isMigrationCommand()` returns false and the config
 * carries the JS engine + PrismaPg adapter (the non-migration shape).
 *
 * The migration-specific shape (engine absent, adapter absent — native Rust
 * engine uses schema.prisma datasource URL directly) is exercised by:
 *   - `npm run smoke:prisma-runtime` (scripts/smoke-prisma-migrate-runtime.sh)
 *   - real `prisma migrate deploy` / `prisma db push` / `prisma studio`
 *     invocations, where `process.argv[1]` is the migration subcommand.
 *
 * This test validates the non-migration shape only.
 */
describe("Prisma CLI configuration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = configImport as any;

  it("uses the JS engine + PrismaPg adapter for non-migration CLI commands", () => {
    expect(config.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(config.migrations?.seed).toBe("tsx prisma/seed.ts");
    // Non-migration CLI commands (validate, format, etc.) share the JS
    // engine + PrismaPg adapter path with the application runtime
    // (lib/prisma.ts), so the same adapter works for both.
    expect(typeof config.adapter).toBe("function");
    expect(config.engine).toBe("js");
    expect(config.experimental).toEqual({ adapter: true });
  });

  it.skipIf(!process.env.PRISMA_TEST_DATABASE_URL)(
    "runs migrate deploy against the test database",
    () => {
      execFileSync("node_modules/.bin/prisma", ["migrate", "deploy"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: process.env.PRISMA_TEST_DATABASE_URL,
          NODE_ENV: "test",
        },
        stdio: "pipe",
      });
    },
  );
});
