import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/database-health";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render readiness probe. Prisma is resolved only when this request runs. */
export async function GET() {
  try {
    await checkDatabaseHealth(getPrisma());

    return NextResponse.json(
      { status: "ok", database: "connected" },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // Do not expose environment values, driver diagnostics or stack traces.
    return NextResponse.json(
      { status: "error", code: "PRISMA_UNAVAILABLE" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
