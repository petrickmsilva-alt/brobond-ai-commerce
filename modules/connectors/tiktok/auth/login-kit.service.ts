import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { getTikTokLoginConfig, type TikTokLoginKitConfig } from "./login-kit.config";

/**
 * TikTok Login Kit v2 service — server-side ONLY.
 *
 * Responsibilities:
 *   1. Build the consent URL (`client_key`, `scope=user.info.stats`,
 *      `response_type=code`, URL-encoded `redirect_uri`, CSRF `state`).
 *   2. Exchange the authorization code for `access_token` / `open_id` via a
 *      `application/x-www-form-urlencoded` POST to the tiktokapis.com host.
 *   3. Upsert the credential (AES-256-GCM ciphertext) on the unified
 *      `Connector` row of the tenant under provider `TIKTOK`.
 *
 * No token value ever leaves this module in plaintext.
 */

/** Unified connector provider used by the Brobond channel manager. */
export const TIKTOK_LOGIN_PROVIDER = "TIKTOK" as const;

export class TikTokLoginError extends Error {
  readonly reason: TikTokLoginFailureReason;

  constructor(reason: TikTokLoginFailureReason, message: string) {
    super(message);
    this.name = "TikTokLoginError";
    this.reason = reason;
  }
}

export type TikTokLoginFailureReason =
  "invalid_request" | "state_mismatch" | "token_exchange" | "provider_denied" | "persistence";

/** Normalized, strictly typed result of a successful code exchange. */
export interface TikTokLoginTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly openId: string;
  readonly scope: string;
  readonly tokenType: string;
  readonly expiresAt: Date;
  readonly refreshExpiresAt: Date | null;
}

/** Raw TikTok v2 token payload (snake_case, as returned by the provider). */
interface TikTokRawTokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  open_id?: unknown;
  scope?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export interface TikTokLoginAuthorizationUrl {
  readonly url: string;
  readonly state: string;
}

export interface TikTokLoginDependencies {
  readonly config?: TikTokLoginKitConfig;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly randomState?: () => string;
}

function toPositiveSeconds(value: unknown): number | null {
  const parsed =
    typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Issue a 256-bit, URL-safe, cryptographically secure state token. */
export function createTikTokLoginState(): string {
  return randomBytes(32).toString("base64url");
}

/** Constant-time comparison of the cookie state against the callback state. */
export function isMatchingState(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Build the TikTok Sandbox consent URL.
 *
 * `URLSearchParams` percent-encodes `redirect_uri` exactly as required by the
 * v2 endpoint, so the registered Sandbox URI matches byte for byte.
 */
export function buildTikTokAuthorizationUrl(
  state: string,
  deps: TikTokLoginDependencies = {},
): string {
  const config = deps.config ?? getTikTokLoginConfig();
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_key", config.clientKey);
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchange an authorization code for the final access token / open id.
 *
 * Transport contract required by TikTok: POST, `Content-Type:
 * application/x-www-form-urlencoded`, body with `client_key`,
 * `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri`.
 */
export async function exchangeTikTokCode(
  code: string,
  deps: TikTokLoginDependencies = {},
): Promise<TikTokLoginTokenSet> {
  const config = deps.config ?? getTikTokLoginConfig();
  const doFetch = deps.fetch ?? fetch;
  const now = (deps.now ?? (() => new Date()))();

  const body = new URLSearchParams({
    client_key: config.clientKey,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  let response: Response;
  try {
    response = await doFetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "no-cache",
        accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
    });
  } catch {
    throw new TikTokLoginError("token_exchange", "Unable to reach the TikTok token endpoint.");
  }

  let payload: TikTokRawTokenPayload;
  try {
    payload = (await response.json()) as TikTokRawTokenPayload;
  } catch {
    throw new TikTokLoginError("token_exchange", "TikTok returned a non-JSON token response.");
  }

  const providerError = asNonEmptyString(payload.error);
  if (!response.ok || providerError) {
    // Provider detail stays server-side; the browser only sees a reason code.
    throw new TikTokLoginError(
      "provider_denied",
      `TikTok rejected the code exchange (${providerError ?? response.status}).`,
    );
  }

  const accessToken = asNonEmptyString(payload.access_token);
  const openId = asNonEmptyString(payload.open_id);
  const expiresIn = toPositiveSeconds(payload.expires_in);
  if (!accessToken || !openId || !expiresIn) {
    throw new TikTokLoginError(
      "token_exchange",
      "TikTok token response is missing access_token, open_id or expires_in.",
    );
  }
  const refreshExpiresIn = toPositiveSeconds(payload.refresh_expires_in);

  return {
    accessToken,
    refreshToken: asNonEmptyString(payload.refresh_token),
    openId,
    scope: asNonEmptyString(payload.scope) ?? config.scope,
    tokenType: asNonEmptyString(payload.token_type) ?? "Bearer",
    expiresAt: new Date(now.getTime() + expiresIn * 1000),
    refreshExpiresAt: refreshExpiresIn ? new Date(now.getTime() + refreshExpiresIn * 1000) : null,
  };
}
