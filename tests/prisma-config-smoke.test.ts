import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
 *   - the regression test below (PR010.4.8 — keys must be ABSENT, not
 *     present-with-undefined; `@prisma/config`'s Effect schema rejects the
 *     latter with a misleading "Failed to parse syntax of config file");
 *   - `npm run smoke:prisma-runtime` (scripts/smoke-prisma-migrate-runtime.sh)
 *   - real `prisma migrate deploy` / `prisma db push` / `prisma studio`
 *     invocations, where `process.argv[1]` is the migration subcommand.
 */
describe("Prisma CLI configuration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = configImport as any;

  const ORIGINAL_ARGV = process.argv;

  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.resetModules();
  });

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

  // PR010.4.8 regression: the migration branch must OMIT the engine/adapter
  // keys entirely. Spreading `{ engine: undefined, adapter: undefined }`
  // makes the keys present-with-undefined, which @prisma/config's Effect
  // schema union rejects — `prisma migrate deploy` aborted with
  // `Failed to parse syntax of config file at "prisma.config.ts"` before
  // doing any migration work (breaking Render's preDeployCommand and the
  // CI smoke test).
  it.each([
    ["migrate deploy", ["migrate", "deploy"]],
    ["migrate dev", ["migrate", "dev"]],
    ["db push", ["db", "push"]],
    ["studio", ["studio"]],
  ])("omits engine/adapter keys entirely for `%s` (PR010.4.8)", async (_label, argv) => {
    process.argv = ["node", "prisma", ...argv];
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const migrationConfig = (await import("../prisma.config")).default as any;

    expect(Object.keys(migrationConfig)).not.toContain("engine");
    expect(Object.keys(migrationConfig)).not.toContain("adapter");
    expect("engine" in migrationConfig).toBe(false);
    expect("adapter" in migrationConfig).toBe(false);
    expect(migrationConfig.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(migrationConfig.migrations).toEqual({ seed: "tsx prisma/seed.ts" });
    expect(migrationConfig.experimental).toEqual({ adapter: true });
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
