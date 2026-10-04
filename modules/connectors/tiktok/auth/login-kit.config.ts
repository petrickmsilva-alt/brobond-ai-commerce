import "server-only";

import { resolveAppBaseUrl } from "@/lib/app-url";

/**
 * TikTok Login Kit v2 configuration (Sandbox-aligned).
 *
 * The TikTok Developers app for Brobond Wear is registered with:
 *   · Platform .......... Web only
 *   · Scope ............. user.info.stats
 *   · Redirect URI ...... http://localhost:3000/api/connectors/tiktok/callback
 *
 * Every value below is read from the environment at call time (never at
 * module load) so the same build can be promoted from the local Sandbox to
 * Render production by swapping environment variables only.
 *
 * NOTE: this is the *Login Kit* (user) OAuth, which is intentionally separate
 * from the PR009 *TikTok Shop* seller OAuth (`TIKTOK_APP_KEY`/`APP_SECRET`,
 * `/api/tiktok/callback`). Both can coexist in the same workspace.
 */

/** Default consent host — `https://www.tiktok.com` (tiktok.com family). */
export const TIKTOK_LOGIN_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";

/** Default token host — `https://open.tiktokapis.com` (tiktokapis.com family). */
export const TIKTOK_LOGIN_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";

/** Exact scope saved in the TikTok Developers Sandbox panel. */
export const TIKTOK_LOGIN_SCOPE = "user.info.stats";

/** The only App Router callback endpoint used by TikTok Login Kit. */
export const TIKTOK_LOGIN_CALLBACK_PATH = "/api/connectors/tiktok/callback";

/** Local Sandbox redirect URI registered in the developer panel. */
export const TIKTOK_LOGIN_DEFAULT_REDIRECT_URI = `http://localhost:3000${TIKTOK_LOGIN_CALLBACK_PATH}`;

/** HttpOnly cookie carrying the CSRF state across the consent round-trip. */
export const TIKTOK_LOGIN_STATE_COOKIE = "brobond_tiktok_oauth_state";

/** State lifetime — mirrors the 10 minute TTL used by every other connector. */
export const TIKTOK_LOGIN_STATE_TTL_SECONDS = 600;

export class TikTokLoginConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TikTokLoginConfigError";
  }
}

export interface TikTokLoginKitConfig {
  readonly clientKey: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly scope: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = read(env, name);
  if (!value) {
    throw new TikTokLoginConfigError(
      `${name} is required for the TikTok Login Kit connector. Add it to .env (Sandbox) or to the Render environment (production).`,
    );
  }
  return value;
}

/**
 * Canonicalize a TikTok redirect URI before it becomes part of an OAuth URL.
 *
 * The provider compares `redirect_uri` byte-for-byte between the authorization
 * and code-exchange requests. A trailing slash creates a different registered
 * callback value, so retain one no-slash form for every server-side use. The
 * public-host comparison below separately prevents the host mismatch that
 * would make the browser omit the CSRF state cookie on TikTok's callback.
 *
 * Query strings and fragments are rejected because they are not part of this
 * application's registered callback contract and would make equality checks
 * ambiguous. This helper is shared by the dormant Shop flow too, hence it
 * validates a generic absolute HTTP(S) URI; Login Kit validates its callback
 * path below.
 */
export function normalizeTikTokRedirectUri(value: string | undefined): string | undefined {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return undefined;

  // Only strip path-ending separators. Query strings/fragments are rejected
  // below, so this cannot mutate a token or query value that happens to end
  // in a slash.
  const normalized = raw.replace(/\/+$/, "");

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TikTokLoginConfigError(
      "TIKTOK_REDIRECT_URI must be an absolute http:// or https:// URL.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TikTokLoginConfigError(
      "TIKTOK_REDIRECT_URI must use http:// (local development) or https:// (Render production).",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TikTokLoginConfigError(
      "TIKTOK_REDIRECT_URI must be a plain callback URL with no credentials, query string or fragment.",
    );
  }

  return normalized;
}

/**
 * Resolve and validate the Login Kit callback URI.
 *
 * When `APP_URL`/`NEXTAUTH_URL` is configured, the OAuth initiator must use
 * precisely that public host plus the callback path. Without this guard an
 * operator can initiate on one Render/custom domain and configure TikTok to
 * return to another; browser host-scoped state cookies then disappear and the
 * callback fails its CSRF double-submit check. Both values are normalized
 * before strict equality so an accidental trailing slash is harmless.
 */
function resolveTikTokLoginRedirectUri(env: NodeJS.ProcessEnv): string {
  const configured = normalizeTikTokRedirectUri(read(env, "TIKTOK_REDIRECT_URI"));
  const appBaseUrl = resolveAppBaseUrl(env);

  if (!configured) {
    if (appBaseUrl) {
      throw new TikTokLoginConfigError(
        `TIKTOK_REDIRECT_URI is required when APP_URL or NEXTAUTH_URL is configured. Set it to ${appBaseUrl}${TIKTOK_LOGIN_CALLBACK_PATH}.`,
      );
    }
    return TIKTOK_LOGIN_DEFAULT_REDIRECT_URI;
  }

  const callbackPath = new URL(configured).pathname;
  if (callbackPath !== TIKTOK_LOGIN_CALLBACK_PATH) {
    throw new TikTokLoginConfigError(
      `TIKTOK_REDIRECT_URI must target ${TIKTOK_LOGIN_CALLBACK_PATH} for the TikTok Login Kit callback.`,
    );
  }

  if (appBaseUrl) {
    const expected = `${appBaseUrl}${TIKTOK_LOGIN_CALLBACK_PATH}`;
    if (configured !== expected) {
      throw new TikTokLoginConfigError(
        `TIKTOK_REDIRECT_URI must equal APP_URL/NEXTAUTH_URL plus ${TIKTOK_LOGIN_CALLBACK_PATH} after trailing-slash normalization.`,
      );
    }
  }

  return configured;
}

/**
 * Resolve the full Login Kit configuration.
 *
 * @throws {TikTokLoginConfigError} when credentials/callback configuration are
 * missing or the configured redirect URI cannot preserve the CSRF state cookie.
 */
export function getTikTokLoginConfig(env: NodeJS.ProcessEnv = process.env): TikTokLoginKitConfig {
  return {
    clientKey: requireEnv(env, "TIKTOK_CLIENT_KEY"),
    clientSecret: requireEnv(env, "TIKTOK_CLIENT_SECRET"),
    redirectUri: resolveTikTokLoginRedirectUri(env),
    scope: read(env, "TIKTOK_SCOPES") ?? TIKTOK_LOGIN_SCOPE,
    authorizeUrl: read(env, "TIKTOK_LOGIN_AUTHORIZE_URL") ?? TIKTOK_LOGIN_AUTHORIZE_URL,
    tokenUrl: read(env, "TIKTOK_LOGIN_TOKEN_URL") ?? TIKTOK_LOGIN_TOKEN_URL,
  };
}

/** `true` when both Login Kit credentials are present in the environment. */
export function hasTikTokLoginCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(read(env, "TIKTOK_CLIENT_KEY") && read(env, "TIKTOK_CLIENT_SECRET"));
}
