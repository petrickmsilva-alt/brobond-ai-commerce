/**
 * Protected-route map and safe-redirect primitives (PR010.2).
 *
 * PURE MODULE — imports nothing but types. It is consumed by three very
 * different runtimes and must stay free of Node, Prisma, NextAuth and React:
 *
 *   1. `middleware.ts`               → Edge runtime
 *   2. Server Components / actions   → Node runtime
 *   3. Vitest                        → plain Node, no bundler
 *
 * SECURITY CONTRACT
 * -----------------
 * `sanitizeNext()` is the single gate every `?next=` value passes through.
 * It accepts only same-origin, absolute *paths*, which is what closes the
 * open-redirect hole: an attacker cannot craft
 * `/login?next=https://evil.example` (or `//evil.example`, or
 * `/\evil.example`) and have the app bounce an authenticated user off-site
 * with their session freshly minted.
 */

/** Query parameter carrying the post-login destination. */
export const NEXT_PARAM = "next";

/** Where a user lands after authenticating without an explicit destination. */
export const DEFAULT_AUTHENTICATED_REDIRECT = "/dashboard";

/** The sign-in route. */
export const LOGIN_ROUTE = "/login";

/**
 * Reserved invite endpoints (PR010.3 §10).
 *
 * `/invite/[token]` redirects here instead of rendering an inline error, so a
 * dead link has a stable, shareable URL with its own explanation. Being static
 * siblings of `[token]`, Next.js resolves them before the dynamic segment —
 * the words themselves can never collide with a real token (tokens are
 * base64url, ≥ 16 chars).
 */
export const INVITE_INVALID_ROUTE = "/invite/invalid";
export const INVITE_EXPIRED_ROUTE = "/invite/expired";

/**
 * The confirmation screen shown after a successful access request (PR010.3 §1).
 *
 * A dedicated route — not an inline state — is what guarantees "nunca
 * retornar para o formulário": the form navigates away with `router.replace`,
 * so the populated form is gone from the history stack entirely.
 */
export const REQUEST_ACCESS_SUCCESS_ROUTE = "/request-access/success";

/**
 * Route prefixes that require an authenticated session.
 *
 * Every entry is matched as "the path itself, or any path below it", so
 * `/products` covers `/products/123/edit` without listing it. The list is the
 * literal §2 contract of PR010.2 plus `/settings`, which has always required
 * a session (its layout calls `requireUser()` server-side) and would
 * otherwise render a server exception instead of a redirect.
 */
export const PROTECTED_ROUTES: readonly string[] = [
  "/dashboard",
  "/products",
  "/creators",
  "/campaigns",
  "/analytics",
  "/outreach",
  "/ai",
  "/matches",
  "/connectors",
  "/settings",
] as const;

/**
 * Routes that exist only for unauthenticated visitors. An already
 * authenticated user hitting one of these is sent to their destination
 * instead of being shown a second login form.
 */
export const AUTH_ROUTES: readonly string[] = [
  "/login",
  "/forgot-password",
  "/reset-password",
] as const;

/**
 * Prefixes the middleware must never touch: the NextAuth endpoints (which
 * must stay reachable to *perform* the sign-in), webhooks and OAuth callbacks
 * (called by third parties that carry no session cookie), and Next.js's own
 * asset routes.
 */
export const PUBLIC_PREFIXES: readonly string[] = [
  "/api/auth",
  "/api/webhooks",
  "/api/tiktok",
  "/api/instagram",
  "/api/whatsapp",
  "/_next",
  "/favicon",
  "/invite",
  "/request-access",
] as const;

/** Whether `pathname` is exactly `prefix` or nested below it. */
export function matchesPrefix(pathname: string, prefix: string): boolean {
  if (!pathname.startsWith("/")) return false;
  if (pathname === prefix) return true;
  return pathname.startsWith(`${prefix}/`);
}

/** Whether `pathname` requires an authenticated session. */
export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => matchesPrefix(pathname, route));
}

/** Whether `pathname` is an unauthenticated-only auth screen. */
export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => matchesPrefix(pathname, route));
}

/** Whether `pathname` must bypass the middleware entirely. */
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

/**
 * Normalize an untrusted `?next=` value into a safe same-origin path.
 *
 * Returns `null` for anything that could leave the origin. Rejected shapes:
 *
 *   - absolute URLs (`https://evil.example`, `http://…`, any `scheme:`)
 *   - protocol-relative URLs (`//evil.example`)
 *   - backslash tricks (`/\evil.example`, `\\evil.example`) — some browsers
 *     normalise `\` to `/`, turning it into a protocol-relative URL
 *   - values that do not start with `/`
 *   - the auth screens themselves (a redirect loop)
 *   - control characters / whitespace injections (`\n`, `\t`, `%0a`)
 */
export function sanitizeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  // Control characters are checked on the RAW value, before trimming. A
  // trailing "\r\n" would otherwise be silently rescued by `trim()`, and a
  // value carrying CRLF is tampering regardless of where it sits — rejecting
  // is the safe direction for something that decides where a freshly
  // authenticated user lands.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  if (/%0a|%0d|%09/i.test(value)) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  // Must be an absolute path on this origin.
  if (!trimmed.startsWith("/")) return null;
  // Protocol-relative (`//host`) and backslash variants (`/\host`).
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;
  if (trimmed.includes("\\")) return null;
  // Any `scheme:` prefix before the first slash would have failed the
  // startsWith("/") check, but an embedded one is still suspicious.
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;

  // Never bounce back into an auth screen — that is a redirect loop.
  const pathOnly = trimmed.split(/[?#]/)[0] ?? trimmed;
  if (isAuthRoute(pathOnly)) return null;

  return trimmed;
}

/**
 * Resolve the post-authentication destination from an untrusted value,
 * falling back to `/dashboard`.
 */
export function resolveNext(value: string | null | undefined): string {
  return sanitizeNext(value) ?? DEFAULT_AUTHENTICATED_REDIRECT;
}

/**
 * Build the login URL that preserves where the user was heading.
 *
 * `/login?next=<path>` whenever a safe destination is known (§1/§2 of the
 * PR010.2 contract: the Dashboard CTA must produce `/login?next=/dashboard`),
 * and a bare `/login` when it is absent or unsafe.
 */
export function buildLoginUrl(next?: string | null): string {
  const safe = sanitizeNext(next);
  if (!safe) return LOGIN_ROUTE;
  return `${LOGIN_ROUTE}?${NEXT_PARAM}=${encodeURIComponent(safe)}`;
}
