import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrapper = readFileSync("scripts/prisma-migrate-deploy-with-repair.cjs", "utf8");
const entrypoint = readFileSync("scripts/docker-entrypoint.sh", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

describe("Prisma failed migration repair wrapper", () => {
  it("targets only the known outreach migration that caused Render P3009", () => {
    expect(wrapper).toContain('"20260922194600_outreach_ai_sales_pipeline"');
    expect(wrapper).toContain('"migrate", "resolve", "--rolled-back"');
  });

  it("refuses to remove partial migration tables that contain data", () => {
    expect(wrapper).toContain("assertPartialOutreachTablesAreEmpty");
    expect(wrapper).toContain("Automatic repair refused");
    expect(wrapper).toContain('SELECT count(*)::int AS "count" FROM "OutreachMessage"');
  });

  it("cleans only the empty objects created by that failed migration", () => {
    expect(wrapper).toContain('DROP TABLE IF EXISTS "FollowUpSequence"');
    expect(wrapper).toContain('DROP TABLE IF EXISTS "OutreachMessage"');
    expect(wrapper).toContain('DROP TABLE IF EXISTS "MessageTemplate"');
    expect(wrapper).toContain('DROP TYPE IF EXISTS "OutreachStatus"');
    expect(wrapper).toContain('DROP TYPE IF EXISTS "TemplateType"');
    expect(wrapper).not.toMatch(/DROP\s+TABLE[\s\S]*CASCADE/i);
  });

  it("is the deploy path for npm, Render and the Docker entrypoint", () => {
    expect(packageJson.scripts["prisma:deploy"]).toBe(
      "node scripts/prisma-migrate-deploy-with-repair.cjs",
    );
    expect(entrypoint).toContain("node scripts/prisma-migrate-deploy-with-repair.cjs");
    expect(dockerfile).toContain(
      "COPY scripts/prisma-migrate-deploy-with-repair.cjs ./scripts/prisma-migrate-deploy-with-repair.cjs",
    );
  });
});
