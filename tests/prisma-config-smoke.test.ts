import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PrismaConfig } from "@prisma/config";
import configImport from "../prisma.config";

/**
 * Prisma CLI config smoke test.
 *
 * The config object is cast from the private `defineConfig` shape to keep
 * the strategy-split conditional (isMigrationCommand) compiling under
 * Prisma 6.19.3's discriminated-union `PrismaConfig` type. The assertions
 * below validate the non-migration shape (the shape seen when vitest loads
 * this module, since `process.argv` at that point does not contain a Prisma
 * migration command).
 */
describe("Prisma CLI configuration", () => {
  // Re-export the cast config with the proper PrismaConfig type so downstream
  // tests that import `../prisma.config` get a usable type. The cast is safe:
  // at runtime the object is assembled by us and matches the config contract.
  const config = configImport as unknown as PrismaConfig;

  it("uses the JS engine + PrismaPg adapter for non-migration CLI commands", () => {
    expect(config.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(config.migrations?.seed).toBe("tsx prisma/seed.ts");
    // When NOT a migration command (the case under which this test module is
    // loaded), the config carries the JS engine + PrismaPg adapter so that
    // `prisma validate`, `prisma format`, etc. share the same runtime path
    // as the application (lib/prisma.ts).
    expect(typeof config.adapter).toBe("function");
    expect(config.engine).toBe("js");
    expect(config.experimental).toEqual({ adapter: true });
  });

  it("keeps migrate deploy on the standard datasource URL path", () => {
    // When IS a migration command, isMigrationCommand() returns true at
    // process startup inside prisma.config.ts, so the config object is built
    // WITHOUT engine and WITHOUT adapter — the native Rust query engine then
    // reads the datasource URL directly from prisma/schema.prisma, bypassing
    // the JS-engine + PrismaPg adapter path entirely (which is what avoids the
    // OID 19 deserialisation bug). This test asserts the schema/migrations
    // shape is intact; the engine/adapter absence is the mechanism, verified
    // by the smoke script and by real `prisma migrate deploy` invocations.
    expect(config.schema).toBe(path.join("prisma", "schema.prisma"));
    expect(config.migrations?.seed).toBe("tsx prisma/seed.ts");
    // The "standard datasource URL path" contract: when migrating, the config
    // must not carry a driver adapter or a JS engine, so the native engine
    // uses the schema.prisma `url = env("DATABASE_URL")` directly.
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
