import type { PrismaClient } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { checkDatabaseHealth, type DatabaseHealthResult } from "@/lib/database-health";

export interface StartupValidationOptions {
  /** A one-shot prestart process closes its pool before handing off to Next. */
  disconnect?: boolean;
}

/**
 * Blocks server startup until the complete runtime/database contract is ready.
 * The npm prestart hook runs this before `next start`, so Render never routes
 * signup traffic to a process that cannot use PostgreSQL.
 */
export async function validateStartup(
  options: StartupValidationOptions = {},
): Promise<DatabaseHealthResult> {
  let prisma: PrismaClient | undefined;

  try {
    // DATABASE_URL, AUTH_SECRET and NEXTAUTH_URL are all mandatory here.
    getEnv();

    // Import only after environment validation, so a missing DATABASE_URL has
    // one explicit startup diagnostic rather than a low-level pg error.
    prisma = (await import("@/lib/prisma")).prisma;
    const health = await checkDatabaseHealth(prisma);

    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "DATABASE_READY",
        ...health,
      }),
    );

    return health;
  } catch (error) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "DATABASE_NOT_READY",
        reason: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  } finally {
    if (options.disconnect && prisma) await prisma.$disconnect();
  }
}
