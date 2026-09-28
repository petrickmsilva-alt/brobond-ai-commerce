#!/usr/bin/env node
/*
 * Brobond AI Commerce OS — Prisma deploy with one-time migration repair
 *
 * Production hit Prisma P3009 after the historical migration
 * 20260922194600_outreach_ai_sales_pipeline failed before PR #36 corrected its
 * Creator foreign key. Once Prisma records a failed migration, every later
 * `migrate deploy` aborts until the failed row is resolved. This wrapper is the
 * safe, deploy-time recovery path for that known failure:
 *
 * 1. If there is no unresolved failure for the known migration, it is a no-op.
 * 2. If the failed migration left only empty partial outreach tables behind,
 *    those partial objects are removed.
 * 3. The failed Prisma migration row is marked as rolled back with the Prisma
 *    CLI, so the corrected migration can be replayed by `migrate deploy`.
 * 4. Finally, it runs the normal `prisma migrate deploy`.
 *
 * The repair deliberately refuses to drop any table that contains data, and it
 * refuses to run if later migrations are already marked finished. Set
 * PRISMA_REPAIR_OUTREACH_MIGRATION=false to disable the repair hook.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const OUTREACH_MIGRATION = "20260922194600_outreach_ai_sales_pipeline";
const DISABLE_REPAIR_VALUES = new Set(["0", "false", "no", "off"]);

const OUTREACH_TABLES = [
  {
    name: "FollowUpSequence",
    countSql: 'SELECT count(*)::int AS "count" FROM "FollowUpSequence"',
    dropSql: 'DROP TABLE IF EXISTS "FollowUpSequence"',
  },
  {
    name: "OutreachMessage",
    countSql: 'SELECT count(*)::int AS "count" FROM "OutreachMessage"',
    dropSql: 'DROP TABLE IF EXISTS "OutreachMessage"',
  },
  {
    name: "MessageTemplate",
    countSql: 'SELECT count(*)::int AS "count" FROM "MessageTemplate"',
    dropSql: 'DROP TABLE IF EXISTS "MessageTemplate"',
  },
];

const OUTREACH_TYPES = [
  'DROP TYPE IF EXISTS "OutreachStatus"',
  'DROP TYPE IF EXISTS "TemplateType"',
];

async function main() {
  if (repairEnabled()) {
    await repairKnownOutreachFailure();
  } else {
    log("PRISMA_REPAIR_SKIPPED", "PRISMA_REPAIR_OUTREACH_MIGRATION disabled");
  }

  await runPrisma(["migrate", "deploy"]);
}

function repairEnabled() {
  const value = process.env.PRISMA_REPAIR_OUTREACH_MIGRATION;
  return value === undefined || !DISABLE_REPAIR_VALUES.has(value.trim().toLowerCase());
}

async function repairKnownOutreachFailure() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required before running Prisma migrations.");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    if (!(await tableExists(client, "_prisma_migrations"))) {
      log("PRISMA_REPAIR_SKIPPED", "_prisma_migrations does not exist yet");
      return;
    }

    const failedMigration = await client.query(
      `
        SELECT "id", "migration_name", "started_at", "logs"
        FROM "_prisma_migrations"
        WHERE "migration_name" = $1
          AND "finished_at" IS NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "started_at" DESC
        LIMIT 1
      `,
      [OUTREACH_MIGRATION],
    );

    if (failedMigration.rowCount === 0) {
      log("PRISMA_REPAIR_SKIPPED", `no unresolved failure for ${OUTREACH_MIGRATION}`);
      return;
    }

    const laterFinishedMigration = await client.query(
      `
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "migration_name" > $1
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "migration_name" ASC
        LIMIT 1
      `,
      [OUTREACH_MIGRATION],
    );

    if (laterFinishedMigration.rowCount > 0) {
      throw new Error(
        `Automatic repair refused: migration ${laterFinishedMigration.rows[0].migration_name} ` +
          `is already finished after ${OUTREACH_MIGRATION}. Inspect the database manually.`,
      );
    }

    log("PRISMA_REPAIR_START", `repairing unresolved failed migration ${OUTREACH_MIGRATION}`);
    await assertPartialOutreachTablesAreEmpty(client);
    await dropPartialOutreachObjects(client);
  } finally {
    await client.end();
  }

  await runPrisma(["migrate", "resolve", "--rolled-back", OUTREACH_MIGRATION]);
  log("PRISMA_REPAIR_DONE", `${OUTREACH_MIGRATION} marked rolled back for replay`);
}

async function tableExists(client, tableName) {
  const regclass =
    tableName === "_prisma_migrations" ? "public._prisma_migrations" : `public."${tableName}"`;
  const result = await client.query('SELECT to_regclass($1) IS NOT NULL AS "exists"', [regclass]);
  return result.rows[0]?.exists === true;
}

async function assertPartialOutreachTablesAreEmpty(client) {
  const nonEmptyTables = [];

  for (const table of OUTREACH_TABLES) {
    if (!(await tableExists(client, table.name))) continue;

    const result = await client.query(table.countSql);
    const count = Number(result.rows[0]?.count ?? 0);
    if (count > 0) {
      nonEmptyTables.push(`${table.name} (${count} row(s))`);
    }
  }

  if (nonEmptyTables.length > 0) {
    throw new Error(
      `Automatic repair refused: the failed ${OUTREACH_MIGRATION} migration left data in ` +
        `${nonEmptyTables.join(", ")}. Back up the database and complete/resolve the migration manually.`,
    );
  }
}

async function dropPartialOutreachObjects(client) {
  await client.query("BEGIN");
  try {
    for (const table of OUTREACH_TABLES) {
      await client.query(table.dropSql);
    }
    for (const dropTypeSql of OUTREACH_TYPES) {
      await client.query(dropTypeSql);
    }
    await client.query("COMMIT");
    log("PRISMA_REPAIR_CLEANED", "removed empty partial outreach migration objects");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

function prismaCommand() {
  const binaryName = process.platform === "win32" ? "prisma.cmd" : "prisma";
  const localBinary = path.resolve(process.cwd(), "node_modules", ".bin", binaryName);
  return fs.existsSync(localBinary) ? localBinary : binaryName;
}

function runPrisma(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(prismaCommand(), args, {
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const suffix = signal ? `signal ${signal}` : `exit code ${code}`;
      reject(new Error(`prisma ${args.join(" ")} failed with ${suffix}`));
    });
  });
}

function log(event, detail) {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      event,
      detail,
    }) + "\n",
  );
}

main().catch((error) => {
  log("PRISMA_DEPLOY_WITH_REPAIR_FAILED", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
