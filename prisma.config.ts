import path from "node:path";
import { defineConfig } from "prisma/config";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Prisma configuration (Prisma 6+).
 * Replaces the deprecated `prisma` key in package.json.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  experimental: { adapter: true },
  engine: "js",
  adapter: async () =>
    new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? "postgresql://user:pass@localhost:5432/db",
    }),
});
