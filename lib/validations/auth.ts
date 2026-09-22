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
