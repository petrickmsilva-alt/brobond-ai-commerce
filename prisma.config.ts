import path from "node:path";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration (Prisma 6+).
 *
 * IMPORTANT: do not configure the pg driver adapter here.
 *
 * The application runtime still uses `@prisma/adapter-pg` in `lib/prisma.ts`,
 * but Prisma Migrate's JavaScript schema engine in Prisma 6.19.3 cannot
 * deserialize PostgreSQL system columns with type OID 19 (`name`) through that
 * adapter on Render/PostgreSQL. `prisma migrate deploy` must therefore use the
 * CLI's standard datasource URL path from `schema.prisma`.
 */
export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
