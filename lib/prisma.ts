import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as typeof globalThis & {
  __brobondPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  let connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    if (process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "production" || !process.env.NEXT_PHASE) {
      console.warn("⚠️ Aviso: DATABASE_URL não foi fornecida durante o build. Usando conexão simulada.");
      connectionString = "postgresql://mock:mock@localhost:5432/mock";
    } else {
      throw new Error("DATABASE_URL is required to initialize Prisma.");
    }
  }

  const positiveInteger = (value: string | undefined): number | undefined => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };

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

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__brobondPrisma) {
    globalForPrisma.__brobondPrisma = createPrismaClient();
  }
  return globalForPrisma.__brobondPrisma;
}

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
