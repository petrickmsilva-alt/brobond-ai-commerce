import { z } from "zod";

/**
 * Centralized, type-safe environment variable access.
 *
 * ENVIRONMENT CONTRACT (PR000.2)
 * ------------------------------
 * The runtime recognises:
 *
 * | Variable          | Required | Purpose                                        |
 * | ----------------- | -------- | ---------------------------------------------- |
 * | `AUTH_SECRET`     | yes      | NextAuth v5 JWT/session signing secret         |
 * | `NEXTAUTH_URL`    | yes      | Canonical URL for NextAuth callbacks/redirects |
 * | `DATABASE_URL`    | yes      | PostgreSQL connection string (Prisma)          |
 * | `AUTH_TRUST_HOST` | no       | `false` disables proxy host trust (on by default) |
 *
 * `APP_URL` was removed in PR000.2 (nothing read it) and is **reintroduced by
 * PR010.3 §12** with a narrower mandate: it is the canonical *public* base URL
 * used to build links handed to humans (invitation links), taking precedence
 * over `NEXTAUTH_URL` for that purpose only — NextAuth itself keeps using
 * `NEXTAUTH_URL` / `AUTH_URL` for callbacks. See `lib/app-url.ts`.
 *
 * FEDERATED SIGN-IN (PR010.2 §4 · PR010.3 §5/§12)
 * -----------------------------------------------
 * Two optional pairs enable Google SSO — either one, complete:
 *
 * | Variable                | Required | Purpose                |
 * | ----------------------- | -------- | ---------------------- |
 * | `AUTH_GOOGLE_ID`        | no       | Google OAuth client id   |
 * | `AUTH_GOOGLE_SECRET`    | no       | Google OAuth secret      |
 * | `GOOGLE_CLIENT_ID`      | no       | alias of AUTH_GOOGLE_ID  |
 * | `GOOGLE_CLIENT_SECRET`  | no       | alias of AUTH_GOOGLE_SECRET |
 *
 * They are optional *as a pair*: a complete pair registers the provider and
 * shows the button; no complete pair hides the button entirely (§5 — a
 * disabled SSO button is never rendered). `lib/auth-providers.ts` owns that
 * predicate and is the only thing the UI consults.
 *
 * SECURITY: this module is server-only. `AUTH_SECRET` and `DATABASE_URL` must
 * never be read from, or forwarded to, a client component. Only variables
 * prefixed with `NEXT_PUBLIC_` are ever safe in the browser, and this project
 * defines none.
 *
 * Validation is lazy during compilation and mandatory at server startup.
 * The npm `prestart` hook calls `getEnv()` before Render begins accepting
 * traffic, so a release with any missing core variable exits immediately.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** PostgreSQL connection string consumed by Prisma. SERVER ONLY. */
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .min(1, "DATABASE_URL is required"),
  /** NextAuth v5 signing secret. SERVER ONLY — never expose to the client. */
  AUTH_SECRET: z
    .string({ required_error: "AUTH_SECRET is required" })
    .min(1, "AUTH_SECRET is required"),
  /** Canonical deployment URL used by NextAuth for callbacks/redirects. */
  NEXTAUTH_URL: z
    .string({ required_error: "NEXTAUTH_URL is required" })
    .min(1, "NEXTAUTH_URL is required")
    .url("NEXTAUTH_URL must be a valid URL"),
  /**
   * Canonical PUBLIC base URL used to build human-facing links (PR010.3 §12)
   * — invitation URLs today. Takes precedence over `NEXTAUTH_URL` for link
   * building only. Optional; `lib/app-url.ts` owns the resolution order.
   */
  APP_URL: z.string().url().optional(),
  /**
   * PR010.3 §12 alias of `AUTH_GOOGLE_ID`. Optional — read together with
   * `GOOGLE_CLIENT_SECRET` by `lib/auth-providers.ts`. SERVER ONLY.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  /**
   * PR010.3 §12 alias of `AUTH_GOOGLE_SECRET`. Optional, but must be supplied
   * alongside `GOOGLE_CLIENT_ID`: a half-configured provider would render a
   * button that fails at the callback. SERVER ONLY.
   */
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  /**
   * Opt OUT of trusting the reverse-proxy forwarded host (`false`/`0`).
   *
   * Trust is on by default — see `lib/auth-trust-host.ts`. It used to be
   * driven solely by this variable, and losing it in the Render dashboard took
   * every `/api/auth/session` call down with `UntrustedHost`.
   */
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

/** Validates an explicit environment object (also useful for startup tests). */
export function validateStartupEnvironment(source: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${parsed.error.issues
        .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data;
}

export function getEnv(): Env {
  if (cached) return cached;
  cached = validateStartupEnvironment(process.env);
  return cached;
}

/** Test-only helper: clears the memoized environment. */
export function resetEnvCache(): void {
  cached = null;
}
