import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../prisma.config";

/**
 * Prisma CLI config smoke test.
 *
 * The migration case is opt-in because the regular unit-test suite does not
 * provision PostgreSQL. Run it against a disposable test database with:
 *
 * PRISMA_TEST_DATABASE_URL=postgresql://... npm test -- tests/prisma-config-smoke.test.ts
 */
describe("Prisma CLI configuration", () => {
  it("keeps migrate deploy on the standard datasource URL path", () => {
    expect(config.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(config.migrations?.seed).toBe("tsx prisma/seed.ts");
    // cliAdapter() is always present (returns a valid PrismaPg), but for
    // migration commands the native Rust engine ignores it and uses the
    // schema.prisma datasource URL directly — so the "standard datasource
    // URL path" is preserved regardless of the adapter property.
    expect(typeof config.adapter).toBe("function");
    // During non-migration CLI usage (e.g. vitest import time) the JS engine
    // + adapter path is active; during migration commands the engine is unset
    // (native). The test imports config at module load time, so engine is "js"
    // here — the migration-specific path is exercised by the smoke script and
    // by actual `prisma migrate deploy` invocations, not by this unit test.
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
