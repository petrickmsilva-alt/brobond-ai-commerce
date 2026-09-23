import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const blueprint = readFileSync("render.yaml", "utf8");

describe("Render database deployment contract", () => {
  it("runs the exact locked build and Prisma generation command", () => {
    expect(blueprint).toContain("buildCommand: npm ci && npx prisma generate && npm run build");
  });

  it("deploys migrations before starting the release", () => {
    expect(blueprint).toContain("preDeployCommand: npx prisma migrate deploy");
  });

  it("uses the database readiness endpoint as Render's health check", () => {
    expect(blueprint).toContain("healthCheckPath: /api/health/database");
  });

  it.each(["DATABASE_URL", "AUTH_SECRET", "NEXTAUTH_URL"])(
    "declares the required %s variable",
    (variable) => {
      expect(blueprint).toContain(`- key: ${variable}`);
    },
  );
});
