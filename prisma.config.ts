import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma configuration (Prisma 6+).
 * Replaces the deprecated `prisma` key in package.json.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
