import type { PrismaClient } from "@prisma/client";

/** Latest migration required by the generated Prisma client in this release. */
export const REQUIRED_DATABASE_MIGRATION = "20260929090000_self_signup_first_tenant";

/** A short ceiling keeps a dead database from hanging Render or signup probes. */
export const DEFAULT_DATABASE_HEALTH_TIMEOUT_MS = 5_000;

export type DatabaseHealthCode =
  | "ENV_INVALID"
  | "PRISMA_UNAVAILABLE"
  | "DATABASE_TIMEOUT"
  | "MIGRATION_PENDING"
  | "SCHEMA_INVALID";

export interface DatabaseHealthStatus {
  prisma: boolean;
  database: boolean;
  migrations: boolean;
}

export interface DatabaseHealthResult extends DatabaseHealthStatus {
  latency: number;
}

interface DatabaseHealthErrorOptions {
  details: string;
  status: DatabaseHealthStatus;
  latency: number;
  cause?: unknown;
}

/** Operational error returned by the health endpoint and rethrown at startup. */
export class DatabaseHealthError extends Error {
  readonly code: DatabaseHealthCode;
  readonly details: string;
  readonly status: DatabaseHealthStatus;
  readonly latency: number;

  constructor(code: DatabaseHealthCode, message: string, options: DatabaseHealthErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "DatabaseHealthError";
    this.code = code;
    this.details = options.details;
    this.status = options.status;
    this.latency = options.latency;
  }
}

export type DatabaseHealthClient = Pick<PrismaClient, "$queryRaw">;

export interface DatabaseHealthOptions {
  timeoutMs?: number;
  now?: () => number;
}

interface SchemaProbeRow {
  organization_table: boolean;
  user_table: boolean;
  workspace_name_column: boolean;
  password_hash_column: boolean;
}

/**
 * Executes a real end-to-end database readiness check.
 *
 * The three phases intentionally use raw SQL: they prove that the driver can
 * reach PostgreSQL, that Prisma migration metadata contains this release, and
 * that the concrete tables/columns consumed by signup exist. A generated
 * client alone cannot prove any of those deployment properties.
 */
export async function checkDatabaseHealth(
  db: DatabaseHealthClient,
  options: DatabaseHealthOptions = {},
): Promise<DatabaseHealthResult> {
  const timeoutMs = positiveTimeout(options.timeoutMs);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const latency = () => Math.max(0, Math.round(now() - startedAt));

  try {
    await withTimeout(
      db.$queryRaw<Array<{ database: number }>>`SELECT 1 AS "database"`,
      timeoutMs,
      () =>
        timeoutFailure("conexão", latency(), {
          prisma: true,
          database: false,
          migrations: false,
        }),
    );
  } catch (error) {
    if (error instanceof DatabaseHealthError) throw error;
    throw new DatabaseHealthError("PRISMA_UNAVAILABLE", "Banco de dados indisponível.", {
      details: diagnostic("O Prisma não conseguiu executar SELECT 1.", error),
      status: { prisma: true, database: false, migrations: false },
      latency: latency(),
      cause: error,
    });
  }

  let migrations: Array<{ migration_name: string }>;
  try {
    migrations = await withTimeout(
      db.$queryRaw<Array<{ migration_name: string }>>`
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "migration_name" = ${REQUIRED_DATABASE_MIGRATION}
          AND "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        LIMIT 1
      `,
      timeoutMs,
      () =>
        timeoutFailure("migrations", latency(), {
          prisma: true,
          database: true,
          migrations: false,
        }),
    );
  } catch (error) {
    if (error instanceof DatabaseHealthError) throw error;
    throw new DatabaseHealthError("MIGRATION_PENDING", "Migration do banco pendente.", {
      details: diagnostic(
        `Não foi possível confirmar ${REQUIRED_DATABASE_MIGRATION} em _prisma_migrations.`,
        error,
      ),
      status: { prisma: true, database: true, migrations: false },
      latency: latency(),
      cause: error,
    });
  }

  if (!migrations.some((row) => row.migration_name === REQUIRED_DATABASE_MIGRATION)) {
    throw new DatabaseHealthError("MIGRATION_PENDING", "Migration do banco pendente.", {
      details: `A migration ${REQUIRED_DATABASE_MIGRATION} não está concluída. Execute npx prisma migrate deploy.`,
      status: { prisma: true, database: true, migrations: false },
      latency: latency(),
    });
  }

  let schema: SchemaProbeRow[];
  try {
    schema = await withTimeout(
      db.$queryRaw<SchemaProbeRow[]>`
        SELECT
          to_regclass('public."Organization"') IS NOT NULL AS "organization_table",
          to_regclass('public."User"') IS NOT NULL AS "user_table",
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'Organization'
              AND column_name = 'workspaceName'
          ) AS "workspace_name_column",
          EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'User'
              AND column_name = 'passwordHash'
          ) AS "password_hash_column"
      `,
      timeoutMs,
      () =>
        timeoutFailure("schema", latency(), {
          prisma: true,
          database: true,
          migrations: true,
        }),
    );
  } catch (error) {
    if (error instanceof DatabaseHealthError) throw error;
    throw new DatabaseHealthError("SCHEMA_INVALID", "Schema do banco inválido.", {
      details: diagnostic("A validação das tabelas e colunas obrigatórias falhou.", error),
      status: { prisma: true, database: true, migrations: true },
      latency: latency(),
      cause: error,
    });
  }

  const row = schema[0];
  const missing = [
    !row?.organization_table ? 'tabela "Organization"' : null,
    !row?.user_table ? 'tabela "User"' : null,
    !row?.workspace_name_column ? 'coluna "Organization.workspaceName"' : null,
    !row?.password_hash_column ? 'coluna "User.passwordHash"' : null,
  ].filter((value): value is string => Boolean(value));

  if (missing.length > 0) {
    throw new DatabaseHealthError("SCHEMA_INVALID", "Schema do banco inválido.", {
      details: `Estrutura ausente: ${missing.join(", ")}.`,
      status: { prisma: true, database: true, migrations: true },
      latency: latency(),
    });
  }

  return {
    prisma: true,
    database: true,
    migrations: true,
    latency: latency(),
  };
}

function positiveTimeout(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0
    ? Math.floor(Number(value))
    : DEFAULT_DATABASE_HEALTH_TIMEOUT_MS;
}

function withTimeout<T>(
  operation: PromiseLike<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), timeoutMs);

    Promise.resolve(operation).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function timeoutFailure(
  phase: string,
  latency: number,
  status: DatabaseHealthStatus,
): DatabaseHealthError {
  return new DatabaseHealthError("DATABASE_TIMEOUT", "Tempo limite do banco excedido.", {
    details: `A fase de ${phase} excedeu o tempo limite configurado.`,
    status,
    latency,
  });
}

function diagnostic(context: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return reason && reason !== "undefined" ? `${context} ${reason}` : context;
}
