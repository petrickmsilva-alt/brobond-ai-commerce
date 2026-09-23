"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { loginWithNextSchema } from "@/lib/validations/auth";
import { resolveNext } from "@/lib/auth-routes";

/**
 * Credentials sign-in server action.
 *
 * SECURITY
 * --------
 * - Runs server-side only; the client never touches `AUTH_SECRET`,
 *   `DATABASE_URL` or any `passwordHash`.
 * - Returns a single generic error message so that an attacker cannot tell
 *   "unknown email" from "wrong password".
 * - There is no public sign-up counterpart — accounts are provisioned
 *   out-of-band or through an `Invitation` (PR010.2 §7).
 * - OPEN REDIRECT (PR010.2): the action returns the post-login destination
 *   instead of letting the client decide. The untrusted `next` value is run
 *   through `resolveNext()`, which accepts only same-origin absolute paths,
 *   so `?next=https://evil.example` collapses to `/dashboard`.
 */
export type LoginActionResult = { ok: true; redirectTo: string } | { ok: false; error: string };

const GENERIC_ERROR = "Email ou senha inválidos.";

export async function loginAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginWithNextSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }

  // Resolved BEFORE the sign-in so a malicious value can never be reflected
  // back to a client that now holds a freshly minted session cookie.
  const redirectTo = resolveNext(parsed.data.next);

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { ok: true, redirectTo };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: GENERIC_ERROR };
    }
    throw error;
  }
}
