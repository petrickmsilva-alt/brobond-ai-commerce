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
    expect(config).not.toHaveProperty("adapter");
    expect(config).not.toHaveProperty("engine");
    expect(config).not.toHaveProperty("experimental");
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
