import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma 6.12 CLI configuration.
 *
 * The runtime continues to create its `PrismaPg` adapter in `lib/prisma.ts`.
 * The CLI intentionally uses its native engine: generation and migrations
 * read the PostgreSQL datasource directly from `schema.prisma`, avoiding a
 * dependency on runtime connection-pool configuration.
 */
export default defineConfig({
  earlyAccess: true,
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
});
