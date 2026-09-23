/**
 * Host-trust policy for Auth.js (production incident fix).
 *
 * Render and Docker terminate TLS in front of the Node process, so requests
 * reach the app with the public hostname in `X-Forwarded-Host` rather than
 * `Host`. Auth.js will not build absolute URLs from a forwarded host unless it
 * is told the proxy is trusted, which is what produced, on every single
 * `/api/auth/session` call in production:
 *
 *   [auth][error] UntrustedHost: Host must be trusted.
 *   URL was: https://brobond-ai-commerce.onrender.com/api/auth/session
 *
 * `AUTH_TRUST_HOST` is declared in `render.yaml` and `docker-compose.yml`, but
 * making the entire session layer depend on one dashboard variable surviving
 * every future deploy is how a total, silent sign-in outage happens. The
 * policy therefore lives in code, and the variable only remains as an
 * explicit escape hatch.
 *
 * Kept free of any NextAuth/Prisma import so it stays trivially unit-testable.
 */

/**
 * The only slice of the environment this policy reads.
 *
 * Deliberately NOT `NodeJS.ProcessEnv`: Next augments that interface with a
 * REQUIRED `NODE_ENV`, so a test could not pass a plain `{ AUTH_TRUST_HOST }`
 * literal without also restating an unrelated variable.
 */
export interface TrustHostEnv {
  AUTH_TRUST_HOST?: string | undefined;
  // Keeps `process.env` (which shares no *declared* property with a one-key
  // interface) assignable, instead of tripping TypeScript's weak-type check.
  [key: string]: string | undefined;
}

/**
 * Whether Auth.js may derive its base URL from the incoming (forwarded) host.
 *
 * - `AUTH_TRUST_HOST=false`/`0` — explicit opt-out, always respected, for a
 *   deployment that pins the host through `NEXTAUTH_URL` itself.
 * - anything else (including unset) — trusted: this app is only ever served
 *   behind a reverse proxy in production, and from localhost in development.
 */
export function resolveTrustHost(env: TrustHostEnv = process.env): boolean {
  const flag = env.AUTH_TRUST_HOST?.trim().toLowerCase();
  return !(flag === "false" || flag === "0");
}
