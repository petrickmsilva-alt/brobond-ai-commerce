/**
 * TikTok Sandbox mode (PR017).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Production TikTok Shop requires an approved app, a verified production
 * domain and video-submission review. Until that approval lands, the whole
 * connector is unusable — every call ends in `PENDING_APPROVAL`. TikTok
 * Developers offers a **Sandbox** (test shops + test accounts registered in
 * the console) that answers on dedicated endpoints and never enforces the
 * commercial production gates.
 *
 * This module is the single decision point for "are we running against the
 * TikTok Sandbox?" and for everything that answer changes:
 *
 *   • which base URLs the HTTP/OAuth clients use,
 *   • whether mock/test credentials are a *failure* or a *supported mode*,
 *   • which channel status is persisted (`SANDBOX_ACTIVE`, falling back to
 *     the functional `PENDING_APPROVAL` when the database enum predates the
 *     sandbox migration),
 *   • the simulated OAuth handshake used by sandbox test accounts.
 *
 * It is intentionally dependency-light (pure functions + lazy Prisma use) so
 * it can be unit-tested without a database and imported from both the
 * connector and the OAuth service without creating a cycle.
 */
import "server-only";

import { createHash } from "node:crypto";
import type { ConnectionStatus } from "@prisma/client";

/** Official TikTok Shop Sandbox hosts (test shops only, no production data). */
export const TIKTOK_SANDBOX_API_BASE_URL = "https://open-api-sandbox.tiktokglobalshop.com";
export const TIKTOK_SANDBOX_AUTH_BASE_URL = "https://auth-sandbox.tiktok-shops.com";
export const TIKTOK_SANDBOX_SELLER_AUTH_URL =
  "https://services.tiktokshop.com/open/authorize?sandbox=true";

/** Status persisted for a channel that is live on the sandbox. */
export const TIKTOK_SANDBOX_STATUS = "SANDBOX_ACTIVE" as const;

/**
 * Functional fallback. Older databases (before the sandbox migration) do not
 * know `SANDBOX_ACTIVE`; writing it would raise a Postgres enum error and
 * break the flow. `PENDING_APPROVAL` is already modelled as an expected,
 * non-failing business state, so the UI keeps rendering the connect/OAuth
 * affordance instead of an error screen.
 */
export const TIKTOK_SANDBOX_FALLBACK_STATUS = "PENDING_APPROVAL" as const;

export const TIKTOK_SANDBOX_MESSAGE =
  "Modo Sandbox do TikTok Developers ativo — fluxo de OAuth simulado liberado para contas de teste cadastradas no console.";

/** Credential markers that unambiguously denote a non-production key. */
const SANDBOX_CREDENTIAL_MARKERS = ["sandbox", "sbx", "test", "mock", "demo", "fake"] as const;

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isTruthyFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on", "enabled", "sandbox"].includes(normalize(value));
}

/** Whether a single credential value looks like a TikTok test credential. */
export function looksLikeSandboxCredential(value: string | undefined): boolean {
  const normalized = normalize(value);
  if (!normalized) return false;
  return SANDBOX_CREDENTIAL_MARKERS.some((marker) => normalized.includes(marker));
}

/**
 * Sandbox mode is enabled either explicitly (operator flag on Render) or
 * implicitly, when the credentials themselves come from the TikTok test
 * environment. The implicit path is what makes a key swap on Render enough
 * to pivot the whole backend — no redeploy of configuration required.
 */
export function isTikTokSandboxMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTruthyFlag(env.TIKTOK_SANDBOX_MODE)) return true;
  if (normalize(env.TIKTOK_ENV) === "sandbox") return true;
  if (normalize(env.TIKTOK_MODE) === "sandbox") return true;
  if (isTruthyFlag(env.TIKTOK_SANDBOX)) return true;
  return (
    looksLikeSandboxCredential(env.TIKTOK_APP_KEY) ||
    looksLikeSandboxCredential(env.TIKTOK_APP_SECRET)
  );
}

export interface TikTokSandboxEndpoints {
  apiBaseUrl: string;
  authBaseUrl: string;
  sellerAuthUrl: string;
  sandbox: boolean;
}

/**
 * Endpoint resolution. Explicit overrides always win (a self-hosted mock
 * gateway is a legitimate sandbox target); otherwise sandbox mode swaps the
 * rigid commercial production hosts for the TikTok Sandbox ones.
 */
export function resolveTikTokEndpoints(
  env: NodeJS.ProcessEnv = process.env,
  defaults: { apiBaseUrl: string; authBaseUrl: string; sellerAuthUrl: string },
): TikTokSandboxEndpoints {
  const sandbox = isTikTokSandboxMode(env);
  return {
    sandbox,
    apiBaseUrl:
      env.TIKTOK_API_BASE_URL?.trim() ||
      (sandbox ? TIKTOK_SANDBOX_API_BASE_URL : defaults.apiBaseUrl),
    authBaseUrl:
      env.TIKTOK_AUTH_BASE_URL?.trim() ||
      (sandbox ? TIKTOK_SANDBOX_AUTH_BASE_URL : defaults.authBaseUrl),
    sellerAuthUrl:
      env.TIKTOK_SELLER_AUTH_URL?.trim() ||
      (sandbox ? TIKTOK_SANDBOX_SELLER_AUTH_URL : defaults.sellerAuthUrl),
  };
}

// ---------------------------------------------------------------------------
// Simulated OAuth for sandbox test accounts
// ---------------------------------------------------------------------------

/**
 * Sandbox authorization codes produced by our own simulated consent screen.
 * A code that does not carry this prefix is still exchanged against the real
 * sandbox token endpoint — the TikTok console can issue genuine test codes.
 */
export const TIKTOK_SANDBOX_CODE_PREFIX = "sandbox_";

export function isSimulatedSandboxCode(code: string): boolean {
  return code.trim().toLowerCase().startsWith(TIKTOK_SANDBOX_CODE_PREFIX);
}

export interface SimulatedSandboxShop {
  shopId: string;
  shopCipher: string;
  shopName: string;
  sellerId: string;
}

export interface SimulatedSandboxSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  shops: SimulatedSandboxShop[];
}

const SIMULATED_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function deterministicSuffix(seed: string): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, 12);
}

/**
 * Deterministic, fully offline token/shop set for a sandbox test account.
 *
 * Deterministic on purpose: re-running the simulated handshake for the same
 * organization reuses the same `shopId`, so the unique constraint upserts
 * instead of multiplying phantom shops across reconnects.
 */
export function createSimulatedSandboxSession(
  organizationId: string,
  options: { now?: Date; code?: string; env?: NodeJS.ProcessEnv } = {},
): SimulatedSandboxSession {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const suffix = deterministicSuffix(`${organizationId}:${env.TIKTOK_APP_KEY ?? "sandbox"}`);
  const shopId = env.TIKTOK_SANDBOX_SHOP_ID?.trim() || `sandbox-shop-${suffix}`;
  return {
    accessToken: `sandbox-access-${suffix}`,
    refreshToken: `sandbox-refresh-${suffix}`,
    expiresAt: new Date(now.getTime() + SIMULATED_TOKEN_TTL_MS),
    shops: [
      {
        shopId,
        shopCipher: env.TIKTOK_SANDBOX_SHOP_CIPHER?.trim() || `sandbox-cipher-${suffix}`,
        shopName: env.TIKTOK_SANDBOX_SHOP_NAME?.trim() || "TikTok Sandbox Test Shop",
        sellerId: env.TIKTOK_SANDBOX_SELLER_ID?.trim() || `sandbox-seller-${suffix}`,
      },
    ],
  };
}

/**
 * Catalog returned by `fetchContent` while the connector runs fully offline
 * (simulated sandbox session). It exercises the exact normalized shape the
 * generic connector framework stores, so the dashboard renders real rows.
 */
export function getSimulatedSandboxProducts(
  shopId: string,
): { productId: string; name: string; description: string; imageUrl: string }[] {
  return [
    {
      productId: `${shopId}-p1`,
      name: "Sandbox Hoodie",
      description: "Produto de teste gerado pelo modo Sandbox do TikTok Developers.",
      imageUrl: "https://p16-oec-sg.ibyteimg.com/sandbox/hoodie.jpeg",
    },
    {
      productId: `${shopId}-p2`,
      name: "Sandbox Sneaker",
      description: "Produto de teste gerado pelo modo Sandbox do TikTok Developers.",
      imageUrl: "https://p16-oec-sg.ibyteimg.com/sandbox/sneaker.jpeg",
    },
  ];
}

// ---------------------------------------------------------------------------
// Status persistence
// ---------------------------------------------------------------------------

/** Postgres rejects unknown enum labels with 22P02 / P2010-style errors. */
function isUnknownEnumValueError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  if (candidate.code === "22P02" || candidate.code === "P2010") return true;
  return (
    message.includes("sandbox_active") ||
    (message.includes("invalid input value for enum") && message.includes("connectionstatus"))
  );
}

export interface TikTokSandboxStatusResult {
  status: typeof TIKTOK_SANDBOX_STATUS | typeof TIKTOK_SANDBOX_FALLBACK_STATUS;
  persisted: boolean;
}

/**
 * Map the channel to `SANDBOX_ACTIVE`, degrading to the functional
 * `PENDING_APPROVAL` fallback when the deployed database has not yet applied
 * the sandbox enum migration. Persistence is best-effort by contract: a
 * reporting write must never convert a working sandbox flow into a crash.
 */
export async function markTikTokSandboxActive(
  organizationId: string,
  source: "sandbox_credentials" | "simulated_oauth" | "sandbox_sync" = "sandbox_credentials",
  deps: {
    db?: {
      connector: {
        upsert: (args: unknown) => Promise<{ id: string }>;
      };
      auditLog: { create: (args: unknown) => Promise<unknown> };
    };
  } = {},
): Promise<TikTokSandboxStatusResult> {
  const db = deps.db ?? (await import("@/lib/prisma")).prisma;
  const { tenantWhere } = await import("@/lib/tenant");
  const { organizationId: org } = tenantWhere(organizationId);

  const write = async (status: string) =>
    db.connector.upsert({
      where: { organizationId_provider: { organizationId: org, provider: "TIKTOK" } },
      update: { status, lastError: TIKTOK_SANDBOX_MESSAGE },
      create: {
        organizationId: org,
        provider: "TIKTOK",
        status,
        lastError: TIKTOK_SANDBOX_MESSAGE,
        metadata: { sandbox: true, sandboxSource: source },
      },
    });

  let status: TikTokSandboxStatusResult["status"] = TIKTOK_SANDBOX_STATUS;
  let connector: { id: string } | null = null;
  try {
    connector = await write(TIKTOK_SANDBOX_STATUS as ConnectionStatus);
  } catch (error) {
    if (!isUnknownEnumValueError(error)) {
      console.error("[tiktok.sandbox] não foi possível persistir o status sandbox", {
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: TIKTOK_SANDBOX_STATUS, persisted: false };
    }
    status = TIKTOK_SANDBOX_FALLBACK_STATUS;
    try {
      connector = await write(TIKTOK_SANDBOX_FALLBACK_STATUS as ConnectionStatus);
    } catch (fallbackError) {
      console.error("[tiktok.sandbox] fallback PENDING_APPROVAL também falhou", {
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      });
      return { status, persisted: false };
    }
  }

  try {
    await db.auditLog.create({
      data: {
        organizationId: org,
        action: "TIKTOK_SANDBOX_ACTIVE",
        entityType: "Connector",
        entityId: connector?.id,
        metadata: { source, status },
      },
    });
  } catch {
    // Audit is observability, never a blocker for the sandbox flow.
  }

  return { status, persisted: true };
}
