"use server";

import { accessRequestSchema } from "@/lib/validations/auth";
import { accessRequestService } from "@/modules/auth/access-request.service";

/**
 * Public "Solicitar acesso" server action (PR010.2 §5).
 *
 * SECURITY
 * --------
 * This is the only unauthenticated write in the product, so it is deliberately
 * narrow:
 *
 * - It writes exactly one inert row (`AccessRequest`) — no password, no role,
 *   no tenant. Nothing in the authentication path reads it, so this action can
 *   never grant access to anything. Approval only unlocks an ADMIN to send an
 *   `Invitation`, which is the single path that creates a `User`.
 * - Every field is length-bounded by the Zod schema before it reaches the
 *   database.
 * - The response is identical for a first submission and a repeat, so the
 *   form cannot be used to probe which emails are already in the queue.
 * - Errors are logged server-side and reported to the visitor as one generic
 *   message; no database detail ever reaches the browser.
 */

export type RequestAccessResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const GENERIC_ERROR = "Não foi possível enviar sua solicitação. Tente novamente em instantes.";

export async function requestAccessAction(input: unknown): Promise<RequestAccessResult> {
  const parsed = accessRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await accessRequestService.submit(parsed.data);
    return { ok: true };
  } catch (error) {
    console.error("[request-access.action]", error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
