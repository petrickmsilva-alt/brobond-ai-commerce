import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Global Prisma client singleton.
 *
 * This client uses the Rust-free query compiler with the `pg` driver
 * adapter — no native query-engine binary is downloaded or bundled.
 *
 * In development, Next.js hot-reloading can create many client instances
 * and exhaust the database connection pool, so we cache the client on the
 * global object.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  // Optional pool cap (e.g. Render starter Postgres or a dev single-connection
  // proxy). Unset → pg's default pool size.
  const poolMax = Number.parseInt(process.env.DATABASE_POOL_MAX ?? "", 10);
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    ...(Number.isFinite(poolMax) && poolMax > 0 ? { max: poolMax } : {}),
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
