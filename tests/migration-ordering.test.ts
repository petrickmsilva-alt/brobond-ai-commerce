import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for migration ordering (root cause of the MIGRATION_PENDING
 * signup outage).
 *
 * `20260922194600_outreach_ai_sales_pipeline` added a foreign key
 *
 *   REFERENCES "CreatorProfile"("id")
 *
 * but the creators table is only renamed from "Creator" to "CreatorProfile" in
 * the LATER `20260923120000_creator_discovery_engine` migration. On a fresh
 * database `prisma migrate deploy` therefore failed with
 *
 *   relation "CreatorProfile" does not exist
 *
 * which blocked every subsequent migration — including
 * `20260929090000_self_signup_first_tenant` — so `/signup` reported
 * MIGRATION_PENDING forever.
 *
 * This test replays every migration in deploy order and asserts that each table
 * named by a `REFERENCES "X"` foreign-key clause already exists at that point,
 * i.e. was created (`CREATE TABLE "X"`) or renamed into (`... RENAME TO "X"`)
 * by an earlier statement. It catches this whole class of "forward reference"
 * bug without needing a live PostgreSQL instance.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, "..", "prisma", "migrations");

function migrationDirsInDeployOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(MIGRATIONS_DIR, name, "migration.sql")))
    // Prisma applies migrations in lexicographic order of the directory name.
    .sort();
}

/** Strip `--` line comments so commented-out SQL never trips the scanner. */
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

describe("Prisma migration ordering", () => {
  const dirs = migrationDirsInDeployOrder();

  it("has migrations to validate", () => {
    expect(dirs.length).toBeGreaterThan(0);
  });

  it("never references a table before it is created or renamed into", () => {
    const existingTables = new Set<string>();
    const violations: string[] = [];

    const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi;
    const renameToRe = /ALTER\s+TABLE\s+"[^"]+"\s+RENAME\s+TO\s+"([^"]+)"/gi;
    const dropTableRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/gi;
    const referencesRe = /REFERENCES\s+"([^"]+)"/gi;

    for (const dir of dirs) {
      const sql = stripSqlComments(
        readFileSync(path.join(MIGRATIONS_DIR, dir, "migration.sql"), "utf8"),
      );

      // A statement may both create a table and add a self-referencing FK, so
      // register all tables created/renamed in this migration BEFORE checking
      // its REFERENCES clauses.
      for (const m of sql.matchAll(createRe)) existingTables.add(m[1]);
      for (const m of sql.matchAll(renameToRe)) existingTables.add(m[1]);

      for (const m of sql.matchAll(referencesRe)) {
        const referenced = m[1];
        if (!existingTables.has(referenced)) {
          violations.push(`${dir}: foreign key REFERENCES "${referenced}" before it exists`);
        }
      }

      // Apply drops last so a table dropped and recreated in the same file is
      // still considered present for that file's references.
      for (const m of sql.matchAll(dropTableRe)) existingTables.delete(m[1]);
    }

    expect(violations).toEqual([]);
  });

  it("keeps the outreach creator foreign key on the pre-rename table name", () => {
    const outreach = readFileSync(
      path.join(MIGRATIONS_DIR, "20260922194600_outreach_ai_sales_pipeline", "migration.sql"),
      "utf8",
    );

    expect(outreach).toContain('REFERENCES "Creator"("id")');
    expect(outreach).not.toContain('REFERENCES "CreatorProfile"("id")');
  });
});
