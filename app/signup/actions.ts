"use server";

import { AuthError } from "next-auth";
import { Prisma } from "@prisma/client";
import { signIn } from "@/lib/auth";
import { resolveNext } from "@/lib/auth-routes";
import { signupSchema } from "@/lib/validations/auth";
import { SignupError, signupService } from "@/modules/auth/signup.service";

/**
 * Self-signup server action (PR010.4 §4 · §8).
 *
 * THE FLOW, IN ORDER
 * ------------------
 *   1. validate the payload (Zod, server-side — the browser's copy is a
 *      convenience, never the authority);
 *   2. provision Organization + ADMIN User + Workspace + defaults + seed in
 *      one transaction;
 *   3. sign the user in with the credentials they just chose;
 *   4. hand back the sanitised destination (`/dashboard`).
 *
 * ERROR CONTRACT (§8) — THE POINT OF THIS FILE
 * --------------------------------------------
 * "Nunca mostrar apenas: 'Revise os campos destacados'."
 *
 * Every failure this action can produce is returned as `fieldErrors`, keyed by
 * the field it belongs to, so the form can render it UNDER that input:
 *
 *   - "Este email já está sendo utilizado…"        → `email`
 *   - "A senha deve ter ao menos 8 caracteres."    → `password`
 *   - "Informe o nome da empresa."                 → `company`
 *   - "WhatsApp inválido — informe DDD e número."  → `whatsapp`
 *   - "É necessário aceitar os termos…"            → `acceptTerms`
 *
 * `error` is a SUMMARY that accompanies those field errors for screen-reader
 * users, never a replacement for them. The only case where it stands alone is
 * a genuine server fault, which by definition belongs to no field.
 *
 * SECURITY
 * --------
 * - `role` is not part of the schema. ADMIN is decided inside the service, and
 *   only ever for a brand-new empty tenant.
 * - The password is hashed inside the service; the plaintext leaves this
 *   function only to `signIn`, which re-verifies it against the digest.
 * - The redirect is resolved through `resolveNext()`, so a crafted
 *   `?next=https://evil.example` cannot bounce a user who has just been issued
 *   a session cookie.
 */

export type SignupActionResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Reserved for genuine server faults — never for a validation problem. */
const UNEXPECTED_ERROR = "Não foi possível criar sua conta agora. Tente novamente em instantes.";

/** Summary that accompanies (never replaces) the per-field messages. */
const VALIDATION_SUMMARY = "Corrija os campos indicados abaixo para continuar.";

const EMAIL_TAKEN = "Este email já está sendo utilizado. Faça login ou use outro email.";

export async function signupAction(input: unknown): Promise<SignupActionResult> {
  const parsed = signupSchema.safeParse(input);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors as Record<string, string[]>;

    return {
      ok: false,
      // The summary names the first concrete problem instead of the useless
      // "revise os campos destacados" this PR is explicitly removing.
      error: firstMessage(fieldErrors) ?? VALIDATION_SUMMARY,
      fieldErrors,
    };
  }

  const data = parsed.data;
  const redirectTo = resolveNext(data.next);

  try {
    await signupService.register(data);
  } catch (error) {
    // Typed, field-attributable failure (duplicate email today).
    if (error instanceof SignupError) {
      return { ok: false, error: error.message, fieldErrors: { [error.field]: [error.message] } };
    }

    // The database's unique index is the authority on duplicates: it is what
    // decides the race between two people signing up with the same email at
    // the same instant. Map it to the same field error as the pre-check.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, error: EMAIL_TAKEN, fieldErrors: { email: [EMAIL_TAKEN] } };
    }

    console.error("[signup.action] provisioning failed", error);
    return { ok: false, error: UNEXPECTED_ERROR };
  }

  // §4 — "Entrar automaticamente". The account exists at this point, so a
  // failure here is a session problem, not a signup problem: say so, and send
  // them to the login screen rather than implying the account was not created.
  try {
    await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        ok: false,
        error: "Sua conta foi criada, mas não conseguimos entrar automaticamente. Faça login.",
      };
    }
    throw error;
  }

  return { ok: true, redirectTo };
}

/** The first concrete message across all fields, for the summary line. */
function firstMessage(fieldErrors: Record<string, string[]>): string | null {
  for (const messages of Object.values(fieldErrors)) {
    const message = messages?.[0];
    if (message) return message;
  }
  return null;
}
