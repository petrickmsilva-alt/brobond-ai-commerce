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

/** Last-resort base used only in local development (matches `next dev`). */
export const LOCAL_FALLBACK_BASE_URL = "http://localhost:3000";

/**
 * Hostnames a server can *bind* to but a browser can never *navigate* to.
 *
 * Render (like Docker) starts Next.js on the wildcard address, so the absolute
 * URL of an inbound request is `http://0.0.0.0:10000/…`. Deriving a redirect
 * from `request.url` therefore sends the browser to `http://0.0.0.0/…`, which
 * Chrome aborts with ERR_ADDRESS_INVALID — the OAuth exchange succeeds and the
 * user still lands on a dead page. Any candidate resolving to one of these is
 * discarded in favour of the next one.
 *
 * `new URL()` normalizes short IPv4 forms, so `http://0.0.0` arrives here as
 * `0.0.0.0` and is caught by the same entry.
 */
const UNROUTABLE_HOSTNAMES = new Set(["0.0.0.0", "[::]", "::"]);

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

/** Whether a browser could actually navigate to this absolute base URL. */
function isNavigable(base: string): boolean {
  try {
    return !UNROUTABLE_HOSTNAMES.has(new URL(base).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The subset of `Request` this module needs — keeps the helper unit-testable. */
export interface RedirectRequestContext {
  url: string;
  headers: { get(name: string): string | null };
}

/** Origin advertised by the reverse proxy (Render terminates TLS upstream). */
function forwardedOrigin(request: RedirectRequestContext | undefined): string {
  const first = (value: string | null | undefined) => value?.split(",")[0]?.trim() ?? "";
  const host =
    first(request?.headers.get("x-forwarded-host")) || first(request?.headers.get("host"));
  if (!host) return "";
  const proto = first(request?.headers.get("x-forwarded-proto")) || "https";
  return `${proto}://${host}`;
}

/**
 * Every browser-navigable base URL candidate, in precedence order and
 * de-duplicated (may be empty).
 *
 * PRECEDENCE: `APP_URL` → `NEXTAUTH_URL` → `X-Forwarded-Host`/`Host` →
 * `request.url`.
 *
 * `resolveRedirectBaseUrl()` takes the first entry; OAuth code exchanges take
 * the whole list, because a `redirect_uri` that does not match the one the
 * provider registered is rejected and the next candidate must be tried (see
 * `modules/marketplace/mercadolivre/mercadolivre.service.ts`).
 */
export function listRedirectBaseUrls(
  request?: RedirectRequestContext,
  env: AppUrlEnv = process.env,
): string[] {
  // `keep` preserves a configured sub-path (https://host/brobond); the proxy
  // header and `request.url` are reduced to their origin, since their path is
  // the callback route itself — never the deployment's base.
  const candidates: Array<{ value: string; keep: boolean }> = [
    ...APP_URL_ENV_KEYS.map((key) => ({ value: normalize(env[key]), keep: true })),
    { value: forwardedOrigin(request), keep: false },
    { value: request?.url ?? "", keep: false },
  ];

  const resolved: string[] = [];
  for (const { value, keep } of candidates) {
    if (!value || !isNavigable(value)) continue;
    let base = value;
    if (!keep) {
      try {
        base = new URL(value).origin;
      } catch {
        continue;
      }
    }
    if (!resolved.includes(base)) resolved.push(base);
  }
  return resolved;
}

/**
 * Absolute base URL to send a *browser* to (OAuth callbacks, redirects).
 *
 * `new URL(path, request.url)` is the obvious thing to write and is wrong
 * behind a proxy: `request.url` carries the address the server is bound to,
 * not the address the user typed. In production that is the wildcard
 * `0.0.0.0:10000`, so the Mercado Livre callback redirected to
 * `http://0.0.0.0/dashboard/connectors?oauth=connected` — a URL Chrome
 * rejects with ERR_ADDRESS_INVALID even though the token exchange worked.
 *
 * PRECEDENCE (first candidate that is a valid, browser-navigable origin):
 *   `APP_URL` → `NEXTAUTH_URL` → `X-Forwarded-Host`/`Host` → `request.url`
 *   → `http://localhost:3000`.
 *
 * The configured variables win over the forwarded host on purpose: they are
 * the deployment's own statement of its public address and cannot be spoofed
 * by a client-supplied header.
 */
export function resolveRedirectBaseUrl(
  request?: RedirectRequestContext,
  env: AppUrlEnv = process.env,
): string {
  return listRedirectBaseUrls(request, env)[0] ?? LOCAL_FALLBACK_BASE_URL;
}

/**
 * The public, absolute URL of the inbound request itself — path included,
 * query string dropped.
 *
 * For an OAuth callback this is literally the `redirect_uri` the provider
 * just used, so it is the ground truth when the configured `APP_URL` and the
 * URI registered in the provider's developer console diverge. Deliberately
 * header-first (the opposite of `resolveRedirectBaseUrl`): the question here
 * is "where did the provider actually deliver the browser?", not "what is our
 * canonical address?".
 *
 * Returns `""` when the request only resolves to an unroutable address.
 */
export function resolveRequestUrl(request: RedirectRequestContext | undefined): string {
  if (!request) return "";
  let pathname = "/";
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return "";
  }
  const forwarded = forwardedOrigin(request);
  for (const candidate of [forwarded, request.url]) {
    if (!candidate || !isNavigable(candidate)) continue;
    try {
      return `${new URL(candidate).origin}${pathname}`;
    } catch {
      continue;
    }
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
