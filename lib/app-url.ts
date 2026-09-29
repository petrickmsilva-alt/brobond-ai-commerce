/**
 * Canonical public base URL of the deployment (PR010.3 §12).
 *
 * WHY THIS EXISTS
 * ---------------
 * PR010.2 built invitation links from `NEXTAUTH_URL` — a variable that belongs
 * to NextAuth (it drives OAuth callbacks) and is therefore about *where
 * NextAuth listens*, not necessarily about the URL a human should click.
 * PR010.3 introduces `APP_URL` as the canonical, human-facing base URL for
 * every link the platform hands to a user (invitation links today; password
 * reset and notification links next). `NEXTAUTH_URL` remains the fallback so
 * existing deployments keep working unchanged.
 *
 * PRECEDENCE: `APP_URL` → `NEXTAUTH_URL` → `""` (relative).
 *
 * SECURITY CONTRACT
 * -----------------
 * - Only `http://` and `https://` origins are accepted; anything else is
 *   treated as absent rather than interpolated into a link.
 * - This module is pure with respect to `process.env` (no caching), so tests
 *   inject an environment object instead of mutating globals.
 * - The returned value is a bare origin (trailing slashes stripped) so
 *   `buildInviteUrl()` can never produce `//invite/…`.
 */

/** Environment variables that may define the public base URL, in precedence order. */
export const APP_URL_ENV_KEYS = ["APP_URL", "NEXTAUTH_URL"] as const;

/** Minimal environment shape — injectable so tests never mutate globals. */
export type AppUrlEnv = Record<string, string | undefined>;

function normalize(raw: string | undefined): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // Collapse any number of trailing slashes so concatenation stays clean.
  const base = trimmed.replace(/\/+$/, "");
  // After stripping, an origin must remain: "https://" alone collapses to
  // "https:", which is not a base URL anyone can build a link from.
  if (!/^https?:\/\/[^/]+/i.test(base)) return "";
  return base;
}

/**
 * The deployment's public base URL (no trailing slash), or `""` when unset or
 * invalid. An empty result means callers should build a relative link.
 */
export function resolveAppBaseUrl(env: AppUrlEnv = process.env): string {
  for (const key of APP_URL_ENV_KEYS) {
    const base = normalize(env[key]);
    if (base) return base;
  }
  return "";
}

/**
 * Build the single-use invitation URL handed to an invitee.
 *
 * The raw token travels in the URL (that IS the delivery channel — only its
 * SHA-256 digest is ever persisted), so this string must be treated as a
 * secret by everything that logs or stores it.
 */
export function buildInviteUrl(baseUrl: string, token: string): string {
  const base = typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "";
  return `${base}/invite/${token}`;
}
