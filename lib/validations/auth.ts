import { z } from "zod";

/** Minimum length accepted for a password (login form + hashing utilities). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Login form schema (client + server).
 *
 * Its sign-up counterpart lives at the bottom of this file (PR010.4 §3). The
 * two are deliberately separate: login asks for the least it can get away
 * with, while `signupSchema` provisions a tenant and therefore validates far
 * more.
 */
export const loginSchema = z.object({
  email: z.string().email("Informe um email válido."),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Server-side schema used by the NextAuth Credentials provider.
 *
 * Deliberately more permissive on length than `loginSchema`: the provider must
 * not reveal password-policy details, it only needs a non-empty string to run
 * a constant-time bcrypt comparison against.
 */
export const credentialsSchema = z.object({
  email: z
    .string()
    .max(320)
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.string().email()),
  password: z.string().min(1).max(256),
});

export type CredentialsInput = z.infer<typeof credentialsSchema>;

// ------------------------------------------------------------------
// PR010.2 — Enterprise Authentication & UX
// ------------------------------------------------------------------

/**
 * Canonical email normalization, shared by every PR010.2 flow.
 *
 * Trimming + lower-casing here means "Ana@Brobond.AI " and "ana@brobond.ai"
 * resolve to the same account, the same invitation and the same reset token —
 * so a user can never be locked out by their keyboard's capitalisation.
 */
export const emailSchema = z
  .string()
  .max(320, "Email muito longo.")
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string().email("Informe um email válido."));

/** Password policy reused by the reset and invite-accept flows. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `A senha deve ter ao menos ${PASSWORD_MIN_LENGTH} caracteres.`)
  .max(256, "A senha deve ter no máximo 256 caracteres.");

/**
 * A raw single-use token as it arrives from a URL.
 *
 * Restricted to the base64url alphabet so a malformed value is rejected
 * before it can reach a database query.
 */
export const tokenSchema = z
  .string()
  .trim()
  .min(16, "Token inválido.")
  .max(512, "Token inválido.")
  .regex(/^[A-Za-z0-9_-]+$/, "Token inválido.");

/**
 * Optional post-login destination carried by `?next=`.
 *
 * NOTE: shape-checking only. The authoritative open-redirect defence is
 * `sanitizeNext()` in `lib/auth-routes.ts`, which every consumer also calls.
 */
export const nextPathSchema = z
  .string()
  .max(2048)
  .optional()
  .nullable()
  .transform((value) => value ?? null);

/** Login form schema extended with the optional redirect target (§3). */
export const loginWithNextSchema = loginSchema.extend({
  next: nextPathSchema,
});

export type LoginWithNextInput = z.infer<typeof loginWithNextSchema>;

// --- PR010.4 §1 — "Solicitar acesso" removed -----------------------
//
// `accessRequestSchema` / `reviewAccessRequestSchema` are gone with the flow
// they described. The public door is now `/signup` (below), which provisions
// a real tenant instead of queueing a lead for an ADMIN to review.

// --- §6 Esqueci minha senha ----------------------------------------

/** Step 1 — ask for a reset link. */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/** Step 3 — redeem the token and set a new password. */
export const resetPasswordSchema = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// --- §7 Convites ----------------------------------------------------

/** ADMIN-only: invite someone into the current workspace. */
export const createInvitationSchema = z.object({
  email: emailSchema,
  name: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  /**
   * The invited role is chosen server-side by an ADMIN. ADMIN is deliberately
   * NOT offered here: promoting someone to ADMIN is a privileged operation
   * that belongs to member management, not to an invite form.
   */
  role: z.enum(["MANAGER", "MEMBER"]).default("MEMBER"),
});

export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

/** Invitee accepting an invitation — carries a password, never a role. */
export const acceptInvitationSchema = z
  .object({
    token: tokenSchema,
    name: z
      .string()
      .trim()
      .max(120)
      .optional()
      .or(z.literal(""))
      .transform((value) => (value && value.trim() ? value.trim() : null)),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

/** ADMIN-only: revoke a pending invitation. */
export const revokeInvitationSchema = z.object({
  id: z.string().trim().min(1, "Convite inválido."),
});

export type RevokeInvitationInput = z.infer<typeof revokeInvitationSchema>;

// ------------------------------------------------------------------
// PR010.4 — Self Signup & First Tenant Setup
// ------------------------------------------------------------------

/**
 * WHY THIS BLOCK EXISTS
 * ---------------------
 * PR010.2/PR010.3 had exactly one public write: an inert `AccessRequest`.
 * PR010.4 replaces it with a real cadastro — `/signup` creates an
 * `Organization`, an ADMIN `User` and the workspace defaults in one
 * transaction. That makes this the most sensitive validator in the codebase,
 * so every field is bounded and every message is written to be shown BELOW
 * THE FIELD IT DESCRIBES (§8): "Revise os campos destacados" is never the
 * whole story a user gets.
 */

/** Maximum accepted length of a person's name. */
export const NAME_MAX_LENGTH = 120;

/** Maximum accepted length of a company / workspace name. */
export const COMPANY_MAX_LENGTH = 160;

/** Full name of the person creating the workspace (§3, obrigatório). */
export const fullNameSchema = z
  .string({ required_error: "Informe seu nome completo." })
  .trim()
  .min(1, "Informe seu nome completo.")
  .min(3, "Seu nome deve ter ao menos 3 caracteres.")
  .max(NAME_MAX_LENGTH, `O nome deve ter no máximo ${NAME_MAX_LENGTH} caracteres.`)
  .refine((value) => /[\p{L}]/u.test(value), {
    message: "Informe um nome válido (apenas números não é um nome).",
  });

/** Company name — becomes the Organization and the workspace (§3, §4). */
export const companySchema = z
  .string({ required_error: "Informe o nome da empresa." })
  .trim()
  .min(1, "Informe o nome da empresa.")
  .min(2, "O nome da empresa deve ter ao menos 2 caracteres.")
  .max(COMPANY_MAX_LENGTH, `O nome da empresa deve ter no máximo ${COMPANY_MAX_LENGTH} caracteres.`)
  .refine((value) => /[\p{L}\p{N}]/u.test(value), {
    message: "Informe um nome de empresa válido.",
  });

/** Digits of a WhatsApp number, with formatting stripped. */
export function normalizeWhatsapp(value: string): string {
  return value.replace(/[^\d]/g, "");
}

/**
 * WhatsApp — REQUIRED in PR010.4 §3 (it was optional on the old access
 * request). Accepts the way Brazilians actually type a number
 * (`+55 (11) 98888-7777`) and validates the DIGITS, not the punctuation, so
 * a correct number is never rejected for its formatting.
 *
 * 10 digits = landline with DDD, 11 = mobile with DDD, up to 15 = the E.164
 * maximum for an international number.
 */
export const whatsappSchema = z
  .string({ required_error: "Informe seu WhatsApp." })
  .trim()
  .min(1, "Informe seu WhatsApp.")
  .max(32, "WhatsApp muito longo.")
  .regex(/^[0-9+()\-\s.]+$/, "Use apenas números e os símbolos + ( ) - . e espaço.")
  .refine((value) => normalizeWhatsapp(value).length >= 10, {
    message: "WhatsApp inválido — informe DDD e número (ex.: 11 98888-7777).",
  })
  .refine((value) => normalizeWhatsapp(value).length <= 15, {
    message: "WhatsApp inválido — número longo demais.",
  })
  .transform((value) => normalizeWhatsapp(value));

/** The terms checkbox (§3). A missing accept is a field error, not a banner. */
export const termsSchema = z.literal(true, {
  errorMap: () => ({ message: "É necessário aceitar os termos para continuar." }),
});

/**
 * The full signup payload.
 *
 * NOTE ON `role`: it is absent on purpose. The first user of a brand-new
 * tenant is ADMIN because `signupService` says so, server-side. A client can
 * never send a role — there is no field to send it in.
 */
export const signupSchema = z
  .object({
    name: fullNameSchema,
    company: companySchema,
    whatsapp: whatsappSchema,
    // `emailSchema` / `passwordSchema` are shared with the login, reset and
    // invite flows, where a missing key is a malformed request rather than an
    // empty form field. Here it IS an empty form field, so the "required"
    // case is given its own Portuguese message before delegating to the
    // shared rules — §8 does not tolerate a bare "Required".
    email: z.string({ required_error: "Informe seu email." }).pipe(emailSchema),
    password: z.string({ required_error: "Crie uma senha." }).pipe(passwordSchema),
    confirmPassword: z
      .string({ required_error: "Confirme sua senha." })
      .min(1, "Confirme sua senha."),
    acceptTerms: termsSchema,
    next: nextPathSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

/** What the form sends (pre-transform). */
export type SignupInput = z.input<typeof signupSchema>;
/** What the service receives (post-transform: trimmed, lowercased, digits). */
export type SignupData = z.output<typeof signupSchema>;

/**
 * Client-side mirror used by the form's resolver.
 *
 * Identical rules, minus `next` (which the page injects server-side). Keeping
 * it a separate export means the browser validates exactly what the server
 * validates — the real-time feedback of §3 can never promise something the
 * server will then reject.
 */
export const signupFormSchema = signupSchema;

/** Field names of the signup form, in the order they are rendered. */
export const SIGNUP_FIELDS = [
  "name",
  "company",
  "whatsapp",
  "email",
  "password",
  "confirmPassword",
  "acceptTerms",
] as const;

export type SignupField = (typeof SIGNUP_FIELDS)[number];
