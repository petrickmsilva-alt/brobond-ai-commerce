import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/database-health";
import { validateStartupEnvironment } from "@/lib/env";
import { reportError } from "@/lib/observability/error-reporter";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render readiness probe. Prisma is resolved only when this request runs. */
export async function GET(request: Request) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const correlationId = request.headers.get("x-correlation-id") ?? undefined;

  try {
    validateStartupEnvironment(process.env);
    await checkDatabaseHealth(getPrisma());

    return NextResponse.json(
      { status: "ok", database: "connected", requestId },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // Do not expose environment values, driver diagnostics or stack traces.
    const environmentInvalid =
      error instanceof Error && error.message.startsWith("Invalid environment variables:");
    reportError(error, {
      requestId,
      correlationId,
      event: "READINESS_CHECK_FAILED",
      code: environmentInvalid ? "ENV_INVALID" : "PRISMA_UNAVAILABLE",
    });
    return NextResponse.json(
      {
        status: "error",
        code: environmentInvalid ? "ENV_INVALID" : "PRISMA_UNAVAILABLE",
        requestId,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
