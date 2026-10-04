import "server-only";

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

/** Local Sandbox redirect URI registered in the developer panel. */
export const TIKTOK_LOGIN_DEFAULT_REDIRECT_URI =
  "http://localhost:3000/api/connectors/tiktok/callback";

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
 * Resolve the full Login Kit configuration.
 *
 * @throws {TikTokLoginConfigError} when the client key/secret are missing.
 */
export function getTikTokLoginConfig(env: NodeJS.ProcessEnv = process.env): TikTokLoginKitConfig {
  return {
    clientKey: requireEnv(env, "TIKTOK_CLIENT_KEY"),
    clientSecret: requireEnv(env, "TIKTOK_CLIENT_SECRET"),
    redirectUri: read(env, "TIKTOK_REDIRECT_URI") ?? TIKTOK_LOGIN_DEFAULT_REDIRECT_URI,
    scope: read(env, "TIKTOK_SCOPES") ?? TIKTOK_LOGIN_SCOPE,
    authorizeUrl: read(env, "TIKTOK_LOGIN_AUTHORIZE_URL") ?? TIKTOK_LOGIN_AUTHORIZE_URL,
    tokenUrl: read(env, "TIKTOK_LOGIN_TOKEN_URL") ?? TIKTOK_LOGIN_TOKEN_URL,
  };
}

/** `true` when both Login Kit credentials are present in the environment. */
export function hasTikTokLoginCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(read(env, "TIKTOK_CLIENT_KEY") && read(env, "TIKTOK_CLIENT_SECRET"));
}
