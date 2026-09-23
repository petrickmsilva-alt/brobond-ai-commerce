import { NextResponse } from "next/server";
import { checkDatabaseHealth, DatabaseHealthError } from "@/lib/database-health";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render/readiness probe for Prisma, PostgreSQL, migrations and schema. */
export async function GET() {
  try {
    // The endpoint diagnoses invalid runtime configuration explicitly. The
    // same validation also runs before the server starts in production.
    getEnv();
    const { prisma } = await import("@/lib/prisma");
    const health = await checkDatabaseHealth(prisma);

    return NextResponse.json(health, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const failure = normalizeHealthError(error);
    return NextResponse.json(
      {
        ...failure.status,
        latency: failure.latency,
        error: {
          code: failure.code,
          message: failure.message,
          details: failure.details,
        },
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}

function normalizeHealthError(error: unknown): DatabaseHealthError {
  if (error instanceof DatabaseHealthError) return error;

  const details = error instanceof Error ? error.message : String(error);
  return new DatabaseHealthError("ENV_INVALID", "Configuração do servidor inválida.", {
    details: details || "Falha de configuração sem diagnóstico.",
    status: { prisma: false, database: false, migrations: false },
    latency: 0,
    cause: error,
  });
}
