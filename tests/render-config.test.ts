import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const blueprint = readFileSync("render.yaml", "utf8");

describe("Render database deployment contract", () => {
  it("runs the exact locked build and Prisma generation command", () => {
    expect(blueprint).toContain("buildCommand: npm ci && npx prisma generate && npm run build");
  });

  it("deploys migrations through the P3009 repair wrapper before starting the release", () => {
    expect(blueprint).toContain("preDeployCommand: npm run prisma:deploy");
    expect(blueprint).toContain("startCommand: npm run prisma:deploy && npm start");
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

  it.each(["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_REDIRECT_URI"])(
    "declares the Login Kit v2 %s variable instead of relying on Shop credentials",
    (variable) => {
      expect(blueprint).toContain(`- key: ${variable}`);
    },
  );
});
