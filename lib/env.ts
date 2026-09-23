import { z } from "zod";

/**
 * Centralized, type-safe environment variable access.
 *
 * ENVIRONMENT CONTRACT (PR000.2)
 * ------------------------------
 * The runtime recognises exactly four variables:
 *
 * | Variable          | Required | Purpose                                        |
 * | ----------------- | -------- | ---------------------------------------------- |
 * | `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret         |
 * | `NEXTAUTH_URL`    | prod     | Canonical URL for NextAuth callbacks/redirects |
 * | `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)          |
 * | `AUTH_TRUST_HOST` | no       | Trust the proxy `Host` header (Render/Docker)  |
 *
 * `APP_URL` and `AUTH_URL` were **removed** in PR000.2: nothing in the runtime
 * read them. `NEXTAUTH_URL` is the single canonical deployment URL.
 *
 * FEDERATED SIGN-IN (PR010.2 §4)
 * ------------------------------
 * Two optional variables enable Google SSO:
 *
 * | Variable             | Required | Purpose                              |
 * | -------------------- | -------- | ------------------------------------ |
 * | `AUTH_GOOGLE_ID`     | no       | Google OAuth client id               |
 * | `AUTH_GOOGLE_SECRET` | no       | Google OAuth client secret           |
 *
 * They are optional *together*: both present registers the provider and shows
 * the button; either missing hides the button entirely (§4 — a disabled SSO
 * button is never rendered). `lib/auth-providers.ts` owns that predicate and
 * is the only thing the UI consults.
 *
 * SECURITY: this module is server-only. `AUTH_SECRET` and `DATABASE_URL` must
 * never be read from, or forwarded to, a client component. Only variables
 * prefixed with `NEXT_PUBLIC_` are ever safe in the browser, and this project
 * defines none.
 *
 * Validation is lazy so the app can build without a full runtime environment
 * (e.g. during `next build` in CI). Call `getEnv()` where a validated
 * environment is actually required.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** PostgreSQL connection string consumed by Prisma. SERVER ONLY. */
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** NextAuth v5 signing secret. SERVER ONLY — never expose to the client. */
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required"),
  /** Canonical deployment URL used by NextAuth for callbacks/redirects. */
  NEXTAUTH_URL: z.string().url().optional(),
  /** Trust the reverse-proxy `Host` header (required on Render/Docker). */
  AUTH_TRUST_HOST: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  /**
   * Google OAuth client id (PR010.2 §4). Optional — omit to run with
   * credentials-only sign-in. SERVER ONLY.
   */
  AUTH_GOOGLE_ID: z.string().min(1).optional(),
  /**
   * Google OAuth client secret (PR010.2 §4). Optional, but must be supplied
   * alongside `AUTH_GOOGLE_ID`: a half-configured provider would render a
   * button that fails at the callback. SERVER ONLY.
   */
  AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  cached = parsed.data;
  return cached;
}

/** Test-only helper: clears the memoized environment. */
export function resetEnvCache(): void {
  cached = null;
}
