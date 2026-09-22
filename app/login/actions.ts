"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { loginSchema } from "@/lib/validations/auth";

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
 *   out-of-band.
 */
export type LoginActionResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Email ou senha inválidos.";

export async function loginAction(input: unknown): Promise<LoginActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: GENERIC_ERROR };
  }

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { ok: false, error: GENERIC_ERROR };
    }
    throw error;
  }
}
