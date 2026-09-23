import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Process-wide Prisma singleton.
 *
 * Next.js can evaluate the module through more than one server bundle and its
 * development hot reloader evaluates it repeatedly. The instance therefore
 * lives on `globalThis` in every environment, including production. That is a
 * stronger guarantee than relying on the ESM cache and prevents duplicate pg
 * pools from exhausting Render PostgreSQL connections.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __brobondPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    // The prestart check validates the complete runtime environment first;
    // this guard keeps every direct/standalone import fail-safe as well.
    throw new Error("DATABASE_URL is required to initialize Prisma.");
  }

  const poolMax = positiveInteger(process.env.DATABASE_POOL_MAX);
  const connectionTimeoutMillis = positiveInteger(process.env.DATABASE_CONNECTION_TIMEOUT_MS);
  const adapter = new PrismaPg({
    connectionString,
    ...(poolMax ? { max: poolMax } : {}),
    ...(connectionTimeoutMillis ? { connectionTimeoutMillis } : {}),
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function positiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export const prisma = globalForPrisma.__brobondPrisma ?? createPrismaClient();

// Cache in production too: server chunks must share exactly one client/pool.
globalForPrisma.__brobondPrisma = prisma;
