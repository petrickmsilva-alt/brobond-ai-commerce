import { execFileSync } from "node:child_process";
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
  it("imports defineConfig with the JavaScript engine and PostgreSQL adapter", async () => {
    expect(config.engine).toBe("js");
    const configWithAdapter = config as typeof config & {
      adapter?: () => Promise<unknown>;
    };
    expect(configWithAdapter.adapter).toEqual(expect.any(Function));

    const adapter = await configWithAdapter.adapter?.();
    expect(adapter).toBeDefined();
    // PrismaPg exposes the driver adapter as an object; construction itself is
    // the important smoke check and does not require a live database.
    expect(typeof adapter).toBe("object");
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
