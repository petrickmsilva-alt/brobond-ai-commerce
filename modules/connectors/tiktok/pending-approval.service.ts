import "server-only";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/tenant";
import { isTikTokSandboxMode } from "./sandbox.service";

export const TIKTOK_PENDING_APPROVAL_MESSAGE =
  "Aguardando homologação e aprovação do cadastro da loja no TikTok Seller Center";

/** Expected business state while TikTok reviews the seller/app registration. */
export class TikTokPendingApprovalError extends Error {
  readonly pendingApproval = true;

  constructor(message = TIKTOK_PENDING_APPROVAL_MESSAGE, options?: ErrorOptions) {
    super(message, options);
    this.name = "TikTokPendingApprovalError";
  }
}

/**
 * Test credentials and credentials explicitly marked as mock never reach TikTok.
 *
 * SANDBOX (PR017): in Sandbox mode the very same credentials are *expected*
 * — they are TikTok Developers test keys. Returning `true` there would park
 * the channel in PENDING_APPROVAL and block the simulated OAuth flow, so the
 * sandbox decision takes precedence and this guard reports `false`.
 */
export function hasMockTikTokCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTikTokSandboxMode(env)) return false;
  return [env.TIKTOK_APP_KEY, env.TIKTOK_APP_SECRET].some((value) =>
    value?.trim().toLowerCase().includes("mock"),
  );
}

/** Authentication rejections represent approval state, while 5xx/network errors do not. */
export function isTikTokAuthenticationError(error: unknown): boolean {
  if (error instanceof TikTokPendingApprovalError) return true;
  if (!error || typeof error !== "object") return false;

  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 401 || candidate.status === 403) return true;
  const code = typeof candidate.code === "number" ? candidate.code : Number(candidate.code);
  if ([10001, 10002, 10003, 105001, 36004004].includes(code)) return true;
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return /auth|credential|app key|app secret|permission|approved|approval|unauthori[sz]ed|forbidden/.test(
    message,
  );
}

/**
 * Persist the expected review state on the unified tenant connector. This
 * operation is deliberately best-effort at call sites: a reporting write can
 * never turn an authentication rejection into a process crash.
 */
export async function markTikTokPendingApproval(
  organizationId: string,
  source: "mock_credentials" | "authentication_rejected",
): Promise<void> {
  const { organizationId: org } = tenantWhere(organizationId);
  const existing = await prisma.connector.findUnique({
    where: { organizationId_provider: { organizationId: org, provider: "TIKTOK" } },
  });
  if (
    existing?.status === "PENDING_APPROVAL" &&
    existing.lastError === TIKTOK_PENDING_APPROVAL_MESSAGE
  ) {
    return;
  }

  const connector = await prisma.connector.upsert({
    where: { organizationId_provider: { organizationId: org, provider: "TIKTOK" } },
    update: {
      status: "PENDING_APPROVAL",
      lastError: TIKTOK_PENDING_APPROVAL_MESSAGE,
    },
    create: {
      organizationId: org,
      provider: "TIKTOK",
      status: "PENDING_APPROVAL",
      lastError: TIKTOK_PENDING_APPROVAL_MESSAGE,
      metadata: { approvalSource: source } as Prisma.InputJsonValue,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: org,
      action: "TIKTOK_PENDING_APPROVAL",
      entityType: "Connector",
      entityId: connector.id,
      metadata: { source } as Prisma.InputJsonValue,
    },
  });
}

export async function throwTikTokPendingApproval(
  organizationId: string,
  source: "mock_credentials" | "authentication_rejected",
  cause?: unknown,
): Promise<never> {
  try {
    await markTikTokPendingApproval(organizationId, source);
  } catch (persistError) {
    console.error("[tiktok.pending-approval] não foi possível persistir o status", {
      error: persistError instanceof Error ? persistError.message : String(persistError),
    });
  }
  throw new TikTokPendingApprovalError(TIKTOK_PENDING_APPROVAL_MESSAGE, { cause });
}
