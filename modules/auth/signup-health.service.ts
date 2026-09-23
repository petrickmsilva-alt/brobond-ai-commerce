import "server-only";

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Migration which adds the Organization workspace/settings columns used by
 * self-signup. A generated Prisma client can be newer than the deployed
 * database, so this is checked explicitly before beginning a write.
 */
export const SELF_SIGNUP_MIGRATION = "20260929090000_self_signup_first_tenant";

export type SignupReadinessCode = "PRISMA_UNAVAILABLE" | "MIGRATION_PENDING" | "SCHEMA_INCOMPLETE";

/** A precise, user-displayable failure from the pre-signup healthcheck. */
export class SignupReadinessError extends Error {
  readonly code: SignupReadinessCode;
  readonly details: string;
  readonly cause?: unknown;

  constructor(code: SignupReadinessCode, message: string, details: string, cause?: unknown) {
    super(message);
    this.name = "SignupReadinessError";
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export type SignupHealthDatabase = Pick<PrismaClient, "$queryRaw">;

export interface SignupReadiness {
  connected: true;
  migration: typeof SELF_SIGNUP_MIGRATION;
  tables: {
    organization: true;
    user: true;
  };
}

/**
 * Verifies every database prerequisite for a signup before the transaction:
 *
 * 1. Prisma can reach PostgreSQL;
 * 2. the self-signup migration is recorded as successfully applied;
 * 3. the Organization and User tables really exist.
 *
 * Checking both migration metadata and the tables produces an actionable
 * answer when a deployment has a generated client/schema but did not execute
 * `prisma migrate deploy` yet — the exact state that otherwise surfaced as an
 * opaque server-action failure during `organization.create()`.
 */
export async function assertSignupReady(
  db: SignupHealthDatabase = prisma,
): Promise<SignupReadiness> {
  try {
    await db.$queryRaw<Array<{ connected: number }>>`SELECT 1 AS connected`;
  } catch (error) {
    throw new SignupReadinessError(
      "PRISMA_UNAVAILABLE",
      "Não foi possível conectar ao banco de dados para concluir o cadastro.",
      "A verificação de conexão do Prisma falhou antes de iniciar a transação.",
      error,
    );
  }

  let migrationRows: Array<{ migration_name: string }>;
  try {
    migrationRows = await db.$queryRaw<Array<{ migration_name: string }>>`
      SELECT "migration_name"
      FROM "_prisma_migrations"
      WHERE "migration_name" = ${SELF_SIGNUP_MIGRATION}
        AND "finished_at" IS NOT NULL
        AND "rolled_back_at" IS NULL
      LIMIT 1
    `;
  } catch (error) {
    throw new SignupReadinessError(
      "MIGRATION_PENDING",
      "O cadastro está indisponível porque a migration de cadastro ainda não foi aplicada.",
      `Execute \`npx prisma migrate deploy\` e confirme a migration ${SELF_SIGNUP_MIGRATION}.`,
      error,
    );
  }

  if (!migrationRows.some((row) => row.migration_name === SELF_SIGNUP_MIGRATION)) {
    throw new SignupReadinessError(
      "MIGRATION_PENDING",
      "O cadastro está indisponível porque a migration de cadastro ainda não foi aplicada.",
      `A migration ${SELF_SIGNUP_MIGRATION} não foi encontrada como concluída em _prisma_migrations.`,
    );
  }

  let tableRows: Array<{ organization: string | null; user: string | null }>;
  try {
    tableRows = await db.$queryRaw<Array<{ organization: string | null; user: string | null }>>`
      SELECT
        to_regclass('public."Organization"') AS "organization",
        to_regclass('public."User"') AS "user"
    `;
  } catch (error) {
    throw new SignupReadinessError(
      "SCHEMA_INCOMPLETE",
      "O cadastro está indisponível porque a estrutura Organization/User não está disponível.",
      "Não foi possível confirmar as tabelas Organization e User após validar a migration.",
      error,
    );
  }

  const tables = tableRows[0];
  if (!tables?.organization || !tables.user) {
    const missing = [!tables?.organization ? "Organization" : null, !tables?.user ? "User" : null]
      .filter(Boolean)
      .join(", ");

    throw new SignupReadinessError(
      "SCHEMA_INCOMPLETE",
      "O cadastro está indisponível porque a estrutura Organization/User não está disponível.",
      `Tabela(s) ausente(s): ${missing || "Organization/User"}.`,
    );
  }

  return {
    connected: true,
    migration: SELF_SIGNUP_MIGRATION,
    tables: { organization: true, user: true },
  };
}
