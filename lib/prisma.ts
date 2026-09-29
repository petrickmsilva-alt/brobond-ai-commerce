import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Process-wide, lazy Prisma singleton.
 *
 * Importing this module is deliberately side-effect free. Next.js imports
 * server modules while collecting build-time route data, where runtime secrets
 * are not available. The client and its pg pool are therefore created only
 * when application code first uses the database.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __brobondPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
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

/** Return the shared client, creating it only at the first database operation. */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__brobondPrisma) {
    globalForPrisma.__brobondPrisma = createPrismaClient();
  }
  return globalForPrisma.__brobondPrisma;
}

/**
 * Backwards-compatible lazy facade for existing `import { prisma }` callers.
 * Merely importing (or re-exporting) it never reads DATABASE_URL. Accessing a
 * Prisma property is a runtime database use and resolves the lazy singleton.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    const client = getPrisma();
    return Reflect.set(client, property, value, client);
  },
});
