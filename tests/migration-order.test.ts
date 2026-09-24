import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * PR010.4.7 — migration order contract.
 *
 * A production database is replayed from zero by `prisma migrate deploy`, in
 * lexicographic order of the migration directory names. A migration may only
 * touch a relation that already exists at that exact point in history.
 *
 * This suite replays the folder statically (no database required) and fails
 * the build if any migration references a table that does not exist yet —
 * the defect that produced, on Render:
 *
 *   P3018 — ERROR: relation "CreatorProfile" does not exist
 *           (20260922194600_outreach_ai_sales_pipeline)
 */

const MIGRATIONS_DIR = path.join("prisma", "migrations");

function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((entry) => statSync(path.join(MIGRATIONS_DIR, entry)).isDirectory())
    .sort();
}

/** Strips `--` line comments so documentation blocks never count as SQL. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

type Statement = {
  kind: "create" | "rename" | "drop" | "reference" | "alter";
  table: string;
  target?: string;
};

/** Parses the relation-level operations of a migration, in file order. */
function parseStatements(sql: string): Statement[] {
  const patterns: Array<{ kind: Statement["kind"]; regex: RegExp }> = [
    { kind: "create", regex: /CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g },
    { kind: "rename", regex: /ALTER TABLE (?:IF EXISTS )?"([^"]+)" RENAME TO "([^"]+)"/g },
    { kind: "drop", regex: /DROP TABLE (?:IF EXISTS )?"([^"]+)"/g },
    { kind: "reference", regex: /REFERENCES "([^"]+)"/g },
    { kind: "alter", regex: /ALTER TABLE (?:IF EXISTS )?"([^"]+)"/g },
  ];

  const statements: Array<Statement & { index: number }> = [];
  for (const { kind, regex } of patterns) {
    for (const match of sql.matchAll(regex)) {
      statements.push({
        kind,
        table: match[1],
        target: match[2],
        index: match.index ?? 0,
      });
    }
  }

  // Keep the physical order of the file: a rename is also matched by the
  // generic `alter` pattern, so the rename must win on the same offset.
  const order: Record<Statement["kind"], number> = {
    create: 0,
    rename: 1,
    drop: 2,
    reference: 3,
    alter: 4,
  };

  return statements
    .sort((a, b) => a.index - b.index || order[a.kind] - order[b.kind])
    .filter((statement, position, all) => {
      if (statement.kind !== "alter") return true;
      // Drop the duplicate `alter` emitted for a `rename` at the same offset.
      return !all.some((other) => other.index === statement.index && other.kind === "rename");
    })
    .map(({ kind, table, target }) => ({ kind, table, target }));
}

/**
 * Replays every migration and returns, per migration, the relations it used
 * before they existed. `guarded` relations are the ones only ever touched
 * inside an idempotent `DO $$ ... $$` guard (the hotfix migrations), which is
 * allowed because the guard checks `to_regclass()` at runtime.
 */
function replay() {
  const existing = new Set<string>();
  const violations: Array<{ migration: string; table: string }> = [];
  const timeline: Array<{ migration: string; creates: string[]; renames: string[] }> = [];

  for (const migration of listMigrations()) {
    const file = path.join(MIGRATIONS_DIR, migration, "migration.sql");
    const sql = stripComments(readFileSync(file, "utf8"));
    const creates: string[] = [];
    const renames: string[] = [];

    for (const statement of parseStatements(sql)) {
      switch (statement.kind) {
        case "create":
          existing.add(statement.table);
          creates.push(statement.table);
          break;
        case "rename":
          if (!existing.has(statement.table)) {
            violations.push({ migration, table: statement.table });
          }
          existing.delete(statement.table);
          existing.add(statement.target as string);
          renames.push(`${statement.table} -> ${statement.target}`);
          break;
        case "drop":
          existing.delete(statement.table);
          break;
        default:
          if (!existing.has(statement.table)) {
            violations.push({ migration, table: statement.table });
          }
      }
    }

    timeline.push({ migration, creates, renames });
  }

  return { violations, timeline, existing };
}

describe("Prisma migration order (replay from an empty database)", () => {
  const { violations, timeline, existing } = replay();

  it("never touches a relation before it exists", () => {
    expect(violations).toEqual([]);
  });

  it("keeps the migrations sorted by their timestamp prefix", () => {
    const names = timeline.map((entry) => entry.migration);
    expect(names).toEqual([...names].sort());
    for (const name of names) {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/);
    }
  });

  it("creates CreatorProfile before the outreach pipeline references it", () => {
    const names = timeline.map((entry) => entry.migration);
    const forwardRename = names.indexOf("20260922194500_creator_profile_forward_rename");
    const outreach = names.indexOf("20260922194600_outreach_ai_sales_pipeline");
    const restore = names.indexOf("20260922194700_creator_profile_restore_for_pr003");
    const discovery = names.indexOf("20260923120000_creator_discovery_engine");

    expect(forwardRename).toBeGreaterThan(-1);
    expect(forwardRename).toBeLessThan(outreach);
    expect(outreach).toBeLessThan(restore);
    expect(restore).toBeLessThan(discovery);
  });

  it("hands the table back to PR003 under its original name", () => {
    const restore = timeline.find(
      (entry) => entry.migration === "20260922194700_creator_profile_restore_for_pr003",
    );
    expect(restore?.renames).toEqual(["CreatorProfile -> Creator"]);

    const discovery = timeline.find(
      (entry) => entry.migration === "20260923120000_creator_discovery_engine",
    );
    expect(discovery?.renames).toEqual(["Creator -> CreatorProfile"]);
  });

  it("ends with CreatorProfile (and no leftover Creator table)", () => {
    expect(existing.has("CreatorProfile")).toBe(true);
    expect(existing.has("Creator")).toBe(false);
  });

  it("guards both hotfix migrations so the replay stays idempotent", () => {
    for (const migration of [
      "20260922194500_creator_profile_forward_rename",
      "20260922194700_creator_profile_restore_for_pr003",
    ]) {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, migration, "migration.sql"), "utf8");
      expect(sql).toContain("DO $$");
      expect(sql).toContain("to_regclass");
      // Never delete migration bookkeeping from inside a migration.
      expect(sql).not.toMatch(/DELETE\s+FROM\s+"?_prisma_migrations"?/i);
    }
  });
});
