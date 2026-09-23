import { z } from "zod";

/** Minimum length accepted for a password (login form + hashing utilities). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Login form schema (client + server).
 *
 * There is no public sign-up schema on purpose: accounts are provisioned
 * out-of-band in PR000.2 (see `prisma/seed.ts`).
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

// --- §5 Solicitar acesso -------------------------------------------

/**
 * Public access-request form.
 *
 * This is the only unauthenticated write in the product, so every field is
 * length-bounded to keep a scripted flood from writing unbounded text.
 */
export const accessRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Informe seu nome completo.")
    .max(120, "Nome muito longo."),
  company: z
    .string()
    .trim()
    .min(2, "Informe o nome da empresa.")
    .max(160, "Nome da empresa muito longo."),
  email: emailSchema,
  whatsapp: z
    .string()
    .trim()
    .max(32, "WhatsApp muito longo.")
    .regex(/^[0-9+()\-\s]*$/, "Use apenas números, espaços e os símbolos + ( ) -.")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value && value.trim() ? value.trim() : null)),
  message: z
    .string()
    .trim()
    .max(2000, "Mensagem muito longa (máx. 2000 caracteres).")
    .optional()
    .or(z.literal(""))
    .transform((value) => (value && value.trim() ? value.trim() : null)),
});

export type AccessRequestInput = z.input<typeof accessRequestSchema>;
export type AccessRequestData = z.output<typeof accessRequestSchema>;

/** ADMIN review decision on a pending access request (§5 / §11). */
export const reviewAccessRequestSchema = z.object({
  id: z.string().trim().min(1, "Solicitação inválida."),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .or(z.literal(""))
    .transform((value) => (value && value.trim() ? value.trim() : null)),
});

export type ReviewAccessRequestInput = z.infer<typeof reviewAccessRequestSchema>;

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
