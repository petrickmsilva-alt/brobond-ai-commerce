"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { reviewAccessRequestSchema } from "@/lib/validations/auth";
import { approvalService } from "@/modules/auth/approval.service";

/**
 * Access-request review actions (PR010.3 §2).
 *
 * This is the canonical implementation of "Aprovar / Rejeitar" for the ADMIN
 * queue at `/dashboard/settings/access` — and, through a thin delegate, for
 * the legacy panel on `/settings`, so the two surfaces can never disagree.
 *
 * RBAC §11 — `requireAdmin()` is the FIRST statement: the UI hiding the
 * buttons is an affordance, not a control. A MANAGER who replays this action
 * by hand gets an `AuthorizationError`, which is reported as a permission
 * error and changes nothing.
 *
 * TENANT: `organizationId` always comes from the authenticated session and is
 * passed to the service — never accepted from the client — so an ADMIN of
 * workspace A cannot invite into workspace B.
 *
 * §2 — "Ao aprovar: Criar Invitation": the approve branch delegates to
 * `approvalService.approve()`, which reviews the request AND issues the
 * invitation (role MEMBER, reviewer's tenant) AND delivers the link through
 * the `InvitationMailer`. The action returns the invite URL exactly once so
 * the ADMIN can copy it (with the ConsoleMailer, the log line carries it too).
 */

const ACCESS_SETTINGS_PATH = "/dashboard/settings/access";
const SETTINGS_PATH = "/settings";

export type ReviewAccessResult =
  | { ok: true; data?: { inviteUrl: string; delivered: boolean } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function revalidateAccessSurfaces() {
  // Both surfaces render the queue; both must reflect the decision.
  revalidatePath(ACCESS_SETTINGS_PATH);
  revalidatePath(SETTINGS_PATH);
}

/**
 * Approve or reject a pending access request.
 *
 * Approve → review + invitation + delivery (§2). Reject → review only.
 */
export async function reviewAccessRequestAction(input: unknown): Promise<ReviewAccessResult> {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: "Você não tem permissão para executar esta ação." };
    }
    throw error;
  }

  const parsed = reviewAccessRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { id, decision, note } = parsed.data;

  try {
    if (decision === "APPROVED") {
      const result = await approvalService.approve({
        requestId: id,
        reviewerId: admin.id,
        organizationId: admin.organizationId,
        note,
      });
      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      revalidateAccessSurfaces();
      return {
        ok: true,
        data: { inviteUrl: result.inviteUrl, delivered: result.delivered },
      };
    }

    const result = await approvalService.reject({
      requestId: id,
      reviewerId: admin.id,
      note,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    revalidateAccessSurfaces();
    return { ok: true };
  } catch (error) {
    console.error("[access-settings.reviewAccessRequest]", error);
    return { ok: false, error: "Erro inesperado. Tente novamente." };
  }
}
