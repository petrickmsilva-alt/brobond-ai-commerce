import "server-only";

import { createHmac } from "node:crypto";

export const TIKTOK_API_BASE_URL = "https://open-api.tiktokglobalshop.com";
export const TIKTOK_AUTH_BASE_URL = "https://auth.tiktok-shops.com";

export interface TikTokApiConfig {
  appKey: string;
  appSecret: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  maxRetries?: number;
}

export interface TikTokApiResponse<T> {
  code: number;
  message?: string;
  request_id?: string;
  data?: T;
}

export interface TikTokRequestOptions {
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  accessToken: string;
  shopCipher?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export class TikTokApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: { status: number; code?: number; requestId?: string; retryAfterMs?: number },
  ) {
    super(message);
    this.name = "TikTokApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

export interface TikTokRateLimitSnapshot {
  remaining: number | null;
  resetAt: Date | null;
}

function requiredEnv(name: "TIKTOK_APP_KEY" | "TIKTOK_APP_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to use the TikTok Shop connector.`);
  return value;
}

/** Returns only server-side config; neither secret is serializable to UI DTOs. */
export function getTikTokApiConfig(): TikTokApiConfig {
  return {
    appKey: requiredEnv("TIKTOK_APP_KEY"),
    appSecret: requiredEnv("TIKTOK_APP_SECRET"),
    apiBaseUrl: process.env.TIKTOK_API_BASE_URL?.trim() || TIKTOK_API_BASE_URL,
  };
}

function toQueryValue(value: string | number | boolean): string {
  return String(value);
}

/**
 * Official TikTok Shop request signing algorithm. `access_token` is excluded
 * from the signing input because it is carried only in x-tts-access-token.
 */
export function signTikTokRequest(
  path: string,
  parameters: Record<string, string | number | boolean | undefined>,
  body: string,
  appSecret: string,
): string {
  const parameterString = Object.entries(parameters)
    .filter(([key, value]) => key !== "sign" && key !== "access_token" && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}${toQueryValue(value!)}`)
    .join("");

  return createHmac("sha256", appSecret)
    .update(`${path}${parameterString}${body}`, "utf8")
    .digest("hex");
}

function retryAfterMs(headers: Headers, now: Date): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const parsed = Date.parse(retryAfter);
    if (!Number.isNaN(parsed)) return Math.max(0, parsed - now.getTime());
  }

  const reset = headers.get("x-ratelimit-reset") ?? headers.get("x-tts-ratelimit-reset");
  if (reset) {
    const numeric = Number(reset);
    if (Number.isFinite(numeric)) {
      // APIs return either an epoch in seconds or milliseconds. Accept both.
      const resetMs = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      return Math.max(0, resetMs - now.getTime());
    }
  }
  return undefined;
}

function parseRateLimit(headers: Headers): TikTokRateLimitSnapshot {
  const remainingRaw =
    headers.get("x-ratelimit-remaining") ?? headers.get("x-tts-ratelimit-remaining");
  const resetRaw = headers.get("x-ratelimit-reset") ?? headers.get("x-tts-ratelimit-reset");
  const remaining =
    remainingRaw === null || !Number.isFinite(Number(remainingRaw)) ? null : Number(remainingRaw);
  const resetNumeric = resetRaw === null ? NaN : Number(resetRaw);
  const resetAt = Number.isFinite(resetNumeric)
    ? new Date(resetNumeric > 10_000_000_000 ? resetNumeric : resetNumeric * 1000)
    : null;
  return { remaining, resetAt };
}

function exponentialBackoff(attempt: number): number {
  // bounded jitter avoids synchronized retries without making tests non-deterministic
  return Math.min(8_000, 250 * 2 ** attempt);
}

/**
 * A single, server-only TikTok Shop HTTP client. It signs every official API
 * request, adds the required headers, safely retries transient failures and
 * preserves rate-limit information for callers/observability.
 */
export class TikTokApiClient {
  private readonly config: Required<Pick<TikTokApiConfig, "appKey" | "appSecret">> &
    TikTokApiConfig;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly maxRetries: number;
  private rateLimit: TikTokRateLimitSnapshot = { remaining: null, resetAt: null };

  constructor(config: TikTokApiConfig = getTikTokApiConfig()) {
    this.config = config;
    this.doFetch = config.fetch ?? fetch;
    this.sleep =
      config.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = config.now ?? (() => new Date());
    this.maxRetries = config.maxRetries ?? 3;
  }

  getRateLimitSnapshot(): TikTokRateLimitSnapshot {
    return { ...this.rateLimit };
  }

  async request<T>(options: TikTokRequestOptions): Promise<T> {
    const method = options.method ?? "POST";
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const query: Record<string, string | number | boolean | undefined> = {
      app_key: this.config.appKey,
      timestamp,
      ...(options.shopCipher ? { shop_cipher: options.shopCipher } : {}),
      ...(options.query ?? {}),
    };
    const body = options.body ? JSON.stringify(options.body) : "";
    const sign = signTikTokRequest(options.path, query, body, this.config.appSecret);
    const url = new URL(options.path, this.config.apiBaseUrl ?? TIKTOK_API_BASE_URL);
    for (const [key, value] of Object.entries({ ...query, sign })) {
      if (value !== undefined) url.searchParams.set(key, toQueryValue(value));
    }

    let lastError: TikTokApiError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      // A known exhausted quota is a signal to wait until reset, rather than
      // sending a request that is guaranteed to be throttled.
      if (
        attempt > 0 &&
        this.rateLimit.remaining === 0 &&
        this.rateLimit.resetAt &&
        this.rateLimit.resetAt.getTime() > this.now().getTime()
      ) {
        await this.sleep(this.rateLimit.resetAt.getTime() - this.now().getTime());
      }

      let response: Response;
      try {
        response = await this.doFetch(url, {
          method,
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            "x-tts-access-token": options.accessToken,
          },
          ...(body ? { body } : {}),
          cache: "no-store",
        });
      } catch {
        const networkError = new TikTokApiError("TikTok Shop network request failed.", {
          status: 503,
        });
        lastError = networkError;
        if (attempt === this.maxRetries) throw networkError;
        await this.sleep(exponentialBackoff(attempt));
        continue;
      }

      this.rateLimit = parseRateLimit(response.headers);
      const responseText = await response.text();
      let payload: TikTokApiResponse<T> | undefined;
      try {
        payload = responseText ? (JSON.parse(responseText) as TikTokApiResponse<T>) : undefined;
      } catch {
        // API error below intentionally contains no raw provider body, which
        // could include seller data and must not reach dashboard logs.
      }

      const apiFailure = !response.ok || (payload !== undefined && payload.code !== 0);
      if (!apiFailure && payload?.data !== undefined) return payload.data;
      if (!apiFailure) {
        throw new TikTokApiError("TikTok Shop returned no response data.", {
          status: response.status,
        });
      }

      const error = new TikTokApiError(payload?.message || "TikTok Shop API request failed.", {
        status: response.status || 502,
        code: payload?.code,
        requestId: payload?.request_id,
        retryAfterMs: retryAfterMs(response.headers, this.now()),
      });
      lastError = error;
      if (!error.retryable || attempt === this.maxRetries) throw error;
      await this.sleep(error.retryAfterMs ?? exponentialBackoff(attempt));
    }

    throw lastError ?? new TikTokApiError("TikTok Shop request failed.", { status: 502 });
  }
}
