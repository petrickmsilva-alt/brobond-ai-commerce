"use server";

import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { createInvitationSchema, revokeInvitationSchema } from "@/lib/validations/auth";
import { InvitationError, invitationService } from "@/modules/auth/invitation.service";
import { invitationDeliveryService } from "@/modules/auth/invitation-delivery.service";

/**
 * Administration server actions for Configurações (PR010.2 §7, §11 ·
 * PR010.4 §1).
 *
 * PR010.4 removed the access-request queue: `/signup` provisions tenants
 * directly, so the only administration left here is inviting teammates into
 * an existing workspace.
 *
 * RBAC §11 — enforced here, server-side, on every single action:
 *   ADMIN   → gerencia convites
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
  { ok: true; data?: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

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
 *
 * PR010.3 §9/§12: the link is built from `APP_URL` (falling back to
 * `NEXTAUTH_URL`) and delivered through the `InvitationMailer` — the
 * ConsoleMailer logs it today, a Resend transport can drop in later without
 * touching this action.
 */
export async function createInvitationAction(
  input: unknown,
): Promise<AdminActionResult<{ inviteUrl: string; email: string }>> {
  try {
    const admin = await requireAdmin();
    const data = createInvitationSchema.parse(input);

    const { invitation, token } = await invitationService.create(admin.organizationId, {
      email: data.email,
      name: data.name,
      role: data.role as UserRole,
      invitedBy: admin.id,
    });

    // Resolves the org name, builds the URL from APP_URL/NEXTAUTH_URL and
    // hands it to the mailer. A mailer failure is non-fatal — the invitation
    // exists and the URL is still returned for the ADMIN to copy.
    const delivery = await invitationDeliveryService.deliverInvitation({
      organizationId: admin.organizationId,
      email: invitation.email,
      name: invitation.name,
      role: invitation.role,
      token,
      expiresAt: invitation.expiresAt,
    });

    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { inviteUrl: delivery.inviteUrl, email: data.email } };
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
// PR010.4 §1 — "Solicitações de acesso" removed
// ------------------------------------------------------------------
// `reviewAccessRequestAction` is gone with the queue it reviewed. There are
// no leads to approve any more: a visitor creates their own Organization and
// ADMIN user at `/signup`. Invitations above remain, but only for what they
// were always actually good at — adding a teammate to an EXISTING workspace.
