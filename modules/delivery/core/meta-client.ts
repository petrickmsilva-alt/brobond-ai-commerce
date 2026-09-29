import "server-only";

import { DeliveryConfigurationError, DeliveryProviderError } from "./delivery.interface";

/**
 * Meta Graph API HTTP core (PR010) — the single network boundary shared by
 * the Instagram Business and WhatsApp Cloud API connectors.
 *
 * OFFICIAL APIs ONLY: every request targets `graph.facebook.com` Meta
 * endpoints. There is no scraping, no browser automation and no unofficial
 * SDK anywhere in the delivery module. All communication is server-side;
 * app credentials are read lazily from the environment and never serialized
 * into DTOs or error messages that could reach the browser.
 */

export const META_GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const META_GRAPH_DEFAULT_VERSION = "v21.0";
export const META_OAUTH_AUTHORIZE_BASE_URL = "https://www.facebook.com";

const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;
const RETRY_CAP_MS = 8_000;

export interface MetaApiConfig {
  appId: string;
  appSecret: string;
  apiBaseUrl: string;
  apiVersion: string;
}

function requiredEnv(name: "META_APP_ID" | "META_APP_SECRET"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new DeliveryConfigurationError(`${name} is required to use the Meta delivery channels.`);
  }
  return value;
}

/** Returns only server-side config; secrets are never put into DTOs. */
export function getMetaApiConfig(): MetaApiConfig {
  return {
    appId: requiredEnv("META_APP_ID"),
    appSecret: requiredEnv("META_APP_SECRET"),
    apiBaseUrl: process.env.META_GRAPH_API_BASE_URL?.trim() || META_GRAPH_API_BASE_URL,
    apiVersion: process.env.META_GRAPH_API_VERSION?.trim() || META_GRAPH_DEFAULT_VERSION,
  };
}

/** The versioned Graph API root, e.g. `https://graph.facebook.com/v21.0`. */
export function metaGraphUrl(config: MetaApiConfig): string {
  return `${config.apiBaseUrl.replace(/\/$/, "")}/${config.apiVersion}`;
}

/** Facebook Login dialog root (Instagram Business / WhatsApp Embedded Signup). */
export function metaAuthorizeUrl(): string {
  const base = process.env.META_OAUTH_AUTHORIZE_BASE_URL?.trim() || META_OAUTH_AUTHORIZE_BASE_URL;
  const version = process.env.META_GRAPH_API_VERSION?.trim() || META_GRAPH_DEFAULT_VERSION;
  return `${base.replace(/\/$/, "")}/${version}/dialog/oauth`;
}

/** Shape of a Meta Graph API error envelope. */
interface MetaErrorEnvelope {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export interface MetaRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  /** Path relative to the versioned root, e.g. `/oauth/access_token`. */
  path: string;
  /** Bearer token; omitted for app-level OAuth exchange calls. */
  accessToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: Record<string, unknown>;
}

export interface MetaHttpDependencies {
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
}

function backoffMs(attempt: number): number {
  // Bounded exponential backoff; deterministic (no jitter) so retry
  // behaviour stays auditable and unit-testable.
  return Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
}

function sanitizeProviderMessage(message: string | undefined, status: number): string {
  // Provider messages may embed request details. Keep a short, safe
  // operator-facing prefix and never echo tokens/urls back.
  const base = (message ?? `Meta Graph API request failed with status ${status}.`).slice(0, 180);
  return base.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]");
}

/**
 * One signed-by-bearer, retrying Meta Graph client. Retries are applied
 * ONLY to `DeliveryProviderError.retryable` failures (408/429/5xx/network).
 */
export class MetaGraphClient {
  private readonly config: MetaApiConfig;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;

  constructor(config: MetaApiConfig, deps: MetaHttpDependencies = {}) {
    this.config = config;
    this.doFetch = deps.fetch ?? fetch;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxRetries = deps.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  get graphUrl(): string {
    return metaGraphUrl(this.config);
  }

  async request<T>(options: MetaRequestOptions): Promise<T> {
    const url = new URL(`${this.graphUrl}${options.path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let lastError: DeliveryProviderError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0 && lastError) await this.sleep(backoffMs(attempt - 1));
      try {
        const response = await this.doFetch(url, {
          method: options.method ?? "GET",
          headers: {
            accept: "application/json",
            ...(options.body ? { "content-type": "application/json" } : {}),
            ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
          cache: "no-store",
        });
        const parsed = await this.parseBody(response);
        if (response.ok) return parsed as T;
        lastError = this.toProviderError(response.status, parsed);
        if (!lastError.retryable) throw lastError;
      } catch (error) {
        if (error instanceof DeliveryProviderError) throw error;
        lastError = new DeliveryProviderError("Unable to reach the Meta Graph API.", {
          status: 0,
          retryable: true,
        });
      }
    }
    throw (
      lastError ??
      new DeliveryProviderError("Meta Graph API request failed after retries.", {
        status: 0,
        retryable: true,
      })
    );
  }

  private async parseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new DeliveryProviderError("Meta Graph API returned an invalid response.", {
        status: response.status,
        retryable: response.status >= 500,
      });
    }
  }

  private toProviderError(status: number, body: unknown): DeliveryProviderError {
    const envelope = (body ?? {}) as MetaErrorEnvelope;
    return new DeliveryProviderError(sanitizeProviderMessage(envelope.error?.message, status), {
      status,
      code: envelope.error?.code,
    });
  }
}

/** App access token (`appid|appsecret`) — server-side diagnostics only. */
export function buildAppAccessToken(config: MetaApiConfig): string {
  return `${config.appId}|${config.appSecret}`;
}
