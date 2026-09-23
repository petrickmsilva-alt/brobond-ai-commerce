/**
 * Federated-provider availability (PR010.2 §4).
 *
 * THE RULE: a provider button is either fully functional or entirely absent.
 * PR010.1 shipped a permanently `disabled` Google button — a dead control
 * that looks like a bug to every user who sees it. This module replaces that
 * with a single source of truth both the auth config and the UI read.
 *
 * SECURITY CONTRACT
 * -----------------
 * `showGoogleProvider()` reads only for *presence*: it returns a boolean and
 * never returns, logs or embeds `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. The
 * secret therefore stays server-side; the client component receives one bit
 * (`true`/`false`) resolved by a Server Component.
 *
 * This module is pure with respect to `process.env` (no caching), so tests
 * can flip the environment between assertions.
 */

/** Environment variables that enable the Google provider. */
export const GOOGLE_ENV_KEYS = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"] as const;

/** Minimal environment shape — injectable so tests never mutate globals. */
export type ProviderEnv = Record<string, string | undefined>;

function present(env: ProviderEnv, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether the Google OAuth provider is provisioned for this deployment.
 *
 * Both the client id and the client secret must be present and non-blank:
 * a half-configured provider would render a button that fails at the
 * callback, which is exactly the broken promise this PR removes.
 */
export function isGoogleProviderConfigured(env: ProviderEnv = process.env): boolean {
  return GOOGLE_ENV_KEYS.every((key) => present(env, key));
}

/**
 * UI predicate consumed by the login card (§4).
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
