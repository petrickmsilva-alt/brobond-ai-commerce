"use server";

import { forgotPasswordSchema, resetPasswordSchema } from "@/lib/validations/auth";
import { PasswordResetError, passwordResetService } from "@/modules/auth/password-reset.service";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/tokens";

/**
 * Password-recovery server actions (PR010.2 §6).
 *
 * FLOW: email → token → nova senha. O token expira em 30 minutos.
 *
 * SECURITY
 * --------
 * - NO USER ENUMERATION: `requestPasswordResetAction` returns the same
 *   `{ ok: true }` for a known and an unknown address. The UI shows the same
 *   "se existir uma conta, enviamos um link" message either way, so the form
 *   cannot be used to harvest valid emails.
 * - The raw token never touches the database. In a deployment with an email
 *   provider it is delivered by email only. Until one is wired, the token is
 *   surfaced ONLY in non-production (`devToken`) so the flow is testable
 *   locally — production returns `undefined`, unconditionally, below.
 * - The new password is validated (length + confirmation) server-side and
 *   bcrypt-hashed before storage.
 */

export type RequestResetResult =
  | { ok: true; devToken?: string; expiresInMinutes: number }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Step 1 — request a reset link. */
export async function requestPasswordResetAction(input: unknown): Promise<RequestResetResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Informe um email válido.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const result = await passwordResetService.request(parsed.data.email);

    // TODO(delivery): send `result.token` by email once a transactional email
    // provider is provisioned. The token is intentionally NOT returned to the
    // browser in production — doing so would let anyone reset any account.
    const devToken =
      process.env.NODE_ENV !== "production" && result.token ? result.token : undefined;

    return { ok: true, devToken, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES };
  } catch (error) {
    console.error("[forgot-password.request]", error);
    // Still generic: an internal failure must not become an enumeration
    // side-channel either.
    return { ok: true, expiresInMinutes: PASSWORD_RESET_TTL_MINUTES };
  }
}

/** Step 3 — redeem the token and store the new password. */
export async function resetPasswordAction(input: unknown): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Revise os campos destacados.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  try {
    await passwordResetService.consume(parsed.data.token, parsed.data.password);
    return { ok: true };
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return { ok: false, error: error.message };
    }
    console.error("[forgot-password.reset]", error);
    return { ok: false, error: "Não foi possível redefinir sua senha. Tente novamente." };
  }
}
