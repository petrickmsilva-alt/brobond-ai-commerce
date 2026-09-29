/**
 * Federated-provider availability (PR010.2 §4 · PR010.3 §5/§12).
 *
 * THE RULE: a provider button is either fully functional or entirely absent.
 * PR010.1 shipped a permanently `disabled` Google button — a dead control
 * that looks like a bug to every user who sees it. This module replaces that
 * with a single source of truth both the auth config and the UI read.
 *
 * ENVIRONMENT (PR010.3 §12)
 * -------------------------
 * Two naming conventions enable the same provider, so a deployment can use
 * whichever its platform prefers:
 *
 *   | Pair                   | Origin                                    |
 *   | ---------------------- | ----------------------------------------- |
 *   | `AUTH_GOOGLE_ID`       | NextAuth v5 native convention (PR010.2)   |
 *   |   + `AUTH_GOOGLE_SECRET`|                                           |
 *   | `GOOGLE_CLIENT_ID`     | PR010.3 §12 alias                         |
 *   |   + `GOOGLE_CLIENT_SECRET` |                                         |
 *
 * A pair only counts when BOTH of its variables are present and non-blank;
 * mixing one variable from each pair does NOT enable the provider (a
 * half-configured provider would render a button that dies at the callback —
 * exactly the broken promise this module exists to prevent). When both pairs
 * are complete the `AUTH_GOOGLE_*` pair wins, preserving every existing
 * deployment's behaviour.
 *
 * SECURITY CONTRACT
 * -----------------
 * `resolveGoogleCredentials()` returns the credentials to `lib/auth.ts` only —
 * server-side, never logged. `showGoogleProvider()` reads only for *presence*:
 * it returns a boolean and never returns, logs or embeds a client id or
 * secret. The secret therefore stays server-side; the client component
 * receives one bit (`true`/`false`) resolved by a Server Component.
 *
 * This module is pure with respect to `process.env` (no caching), so tests
 * can flip the environment between assertions.
 */

/** Environment variables that can enable the Google provider. */
export const GOOGLE_ENV_KEYS = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

/** Minimal environment shape — injectable so tests never mutate globals. */
export type ProviderEnv = Record<string, string | undefined>;

/** Resolved Google OAuth credentials — never leave the server. */
export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

function present(env: ProviderEnv, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Resolve the Google OAuth credentials from the environment, or `null` when
 * the provider is not (fully) provisioned.
 *
 * `lib/auth.ts` calls this to register the provider; `isGoogleProviderConfigured()`
 * calls it to decide button visibility. One resolver, two consumers — UI and
 * auth config cannot drift.
 */
export function resolveGoogleCredentials(env: ProviderEnv = process.env): GoogleCredentials | null {
  if (present(env, "AUTH_GOOGLE_ID") && present(env, "AUTH_GOOGLE_SECRET")) {
    return {
      clientId: (env.AUTH_GOOGLE_ID as string).trim(),
      clientSecret: (env.AUTH_GOOGLE_SECRET as string).trim(),
    };
  }
  if (present(env, "GOOGLE_CLIENT_ID") && present(env, "GOOGLE_CLIENT_SECRET")) {
    return {
      clientId: (env.GOOGLE_CLIENT_ID as string).trim(),
      clientSecret: (env.GOOGLE_CLIENT_SECRET as string).trim(),
    };
  }
  return null;
}

/**
 * Whether the Google OAuth provider is provisioned for this deployment.
 *
 * At least one complete pair (`AUTH_GOOGLE_*` or `GOOGLE_CLIENT_*`) must be
 * present; blanks count as absent.
 */
export function isGoogleProviderConfigured(env: ProviderEnv = process.env): boolean {
  return resolveGoogleCredentials(env) !== null;
}

/**
 * UI predicate consumed by the login card (§4/§5).
 *
 * `true` → render an enabled "Continuar com Google" button.
 * `false` → render nothing at all. Never render it disabled.
 */
export function showGoogleProvider(env: ProviderEnv = process.env): boolean {
  return isGoogleProviderConfigured(env);
}

/** Identifiers of the providers available to the login screen. */
export interface AvailableProviders {
  /** Always available — the platform's primary credential is email + senha. */
  credentials: true;
  google: boolean;
}

/**
 * Snapshot of provider availability, safe to serialize into a Client
 * Component. Contains booleans only — never an id, never a secret.
 */
export function getAvailableProviders(env: ProviderEnv = process.env): AvailableProviders {
  return {
    credentials: true,
    google: showGoogleProvider(env),
  };
}
