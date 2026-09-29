"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { acceptInvitationSchema } from "@/lib/validations/auth";
import { InvitationError, invitationService } from "@/modules/auth/invitation.service";
import { DEFAULT_AUTHENTICATED_REDIRECT } from "@/lib/auth-routes";

/**
 * Invitation acceptance server action (PR010.2 §7).
 *
 * FLOW: validar convite → definir senha → entrar automaticamente.
 *
 * SECURITY
 * --------
 * - The tenant and the role come from the stored `Invitation`, never from this
 *   payload. The schema accepts only `{ token, name?, password }`, so an
 *   invitee cannot grant themselves ADMIN or land in another workspace by
 *   editing a form field.
 * - The invitation is consumed inside the same transaction that writes the
 *   user (see `invitation.service.ts`), so a replayed link cannot create a
 *   second account.
 * - The auto-login reuses the ordinary Credentials provider with the password
 *   the invitee just chose: no side-door session minting, no bypass of
 *   `authorize()`. If that call fails for any reason the account still exists,
 *   and we simply send the user to the login screen.
 * - The redirect target is the hardcoded `/dashboard` — never a value taken
 *   from the URL.
 */

export type AcceptInvitationResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function acceptInvitationAction(input: unknown): Promise<AcceptInvitationResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { token, password, name } = parsed.data;

  let email: string;
  try {
    const accepted = await invitationService.accept(token, { password, name });
    email = accepted.email;
  } catch (error) {
    if (error instanceof InvitationError) {
      return { ok: false, error: error.message };
    }
    console.error("[invite.accept]", error);
    return { ok: false, error: "Não foi possível ativar seu convite. Tente novamente." };
  }

  // Sign in through the normal credentials path (§7 — "entrar automaticamente").
  try {
    await signIn("credentials", { email, password, redirect: false });
    return { ok: true, redirectTo: DEFAULT_AUTHENTICATED_REDIRECT };
  } catch (error) {
    if (error instanceof AuthError) {
      // The account was created successfully — only the convenience login
      // failed, so send the user to /login rather than losing their progress.
      return { ok: true, redirectTo: "/login" };
    }
    throw error;
  }
}
