"use server";

import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import {
  createInvitationSchema,
  reviewAccessRequestSchema,
  revokeInvitationSchema,
} from "@/lib/validations/auth";
import { accessRequestService } from "@/modules/auth/access-request.service";
import { InvitationError, invitationService } from "@/modules/auth/invitation.service";

/**
 * Administration server actions for Configurações (PR010.2 §5, §7, §11).
 *
 * RBAC §11 — enforced here, server-side, on every single action:
 *   ADMIN   → gerencia convites · aprova acesso
 *   MANAGER → sem convites (blocked by `requireAdmin`)
 *   MEMBER  → leitura (blocked by `requireAdmin`)
 *
 * `requireAdmin()` is the first statement of every exported function: the UI
 * hiding a button is an affordance, not a control. A MANAGER who replays this
 * action by hand gets an `AuthorizationError`.
 *
 * TENANT: `organizationId` always comes from the authenticated session and is
 * passed as the first argument to the service. It is NEVER accepted from the
 * client, so an ADMIN of workspace A cannot invite into workspace B.
 */

const SETTINGS_PATH = "/settings";

export type AdminActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function fail(error: unknown, scope: string): AdminActionResult<never> {
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  if (error instanceof InvitationError) {
    return { ok: false, error: error.message };
  }
  console.error(`[settings.${scope}]`, error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

// ------------------------------------------------------------------
// §7 — Convites (ADMIN only)
// ------------------------------------------------------------------

/**
 * Issue an invitation.
 *
 * Returns the invite URL exactly once so the ADMIN can copy it. The raw token
 * is never persisted and never re-readable: if it is lost, the ADMIN re-sends
 * the invite, which rotates the token and kills the previous link.
 */
export async function createInvitationAction(
  input: unknown,
): Promise<AdminActionResult<{ inviteUrl: string; email: string }>> {
  try {
    const admin = await requireAdmin();
    const data = createInvitationSchema.parse(input);

    const { token } = await invitationService.create(admin.organizationId, {
      email: data.email,
      name: data.name,
      role: data.role as UserRole,
      invitedBy: admin.id,
    });

    const baseUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "") ?? "";
    const inviteUrl = `${baseUrl}/invite/${token}`;

    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { inviteUrl, email: data.email } };
  } catch (error) {
    return fail(error, "createInvitation");
  }
}

/** Revoke a PENDING invitation. Tenant-scoped inside the service. */
export async function revokeInvitationAction(input: unknown): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    const { id } = revokeInvitationSchema.parse(input);

    const revoked = await invitationService.revoke(admin.organizationId, id);
    if (!revoked) {
      return { ok: false, error: "Convite não encontrado ou já utilizado." };
    }

    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    return fail(error, "revokeInvitation");
  }
}

// ------------------------------------------------------------------
// §5 — Solicitações de acesso (ADMIN only)
// ------------------------------------------------------------------

/**
 * Approve or reject a pending access request.
 *
 * Approving records the decision ONLY. It does not create a user and does not
 * send anything: the ADMIN still has to issue an invitation explicitly. Two
 * deliberate steps mean a misclick can never provision access.
 */
export async function reviewAccessRequestAction(input: unknown): Promise<AdminActionResult> {
  try {
    const admin = await requireAdmin();
    const data = reviewAccessRequestSchema.parse(input);

    const reviewed = await accessRequestService.review(
      data.id,
      data.decision,
      admin.id,
      data.note,
    );
    if (!reviewed) {
      return { ok: false, error: "Solicitação não encontrada." };
    }

    revalidatePath(SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    return fail(error, "reviewAccessRequest");
  }
}
