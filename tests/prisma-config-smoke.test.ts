import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import configImport from "../prisma.config";

/**
 * Prisma CLI config smoke test.
 *
 * Prisma 6.12 uses its native CLI engine and loads connection configuration
 * from the datasource in `schema.prisma`. Runtime adapter configuration stays
 * isolated in `lib/prisma.ts`.
 */
describe("Prisma CLI configuration", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config = configImport as any;

  const ORIGINAL_ARGV = process.argv;

  afterEach(() => {
    process.argv = ORIGINAL_ARGV;
    vi.resetModules();
  });

  it("uses the schema and migrations directory", () => {
    expect(config.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(config.migrations).toEqual({
      path: path.join("prisma", "migrations"),
    });
    expect(config.earlyAccess).toBe(true);
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
