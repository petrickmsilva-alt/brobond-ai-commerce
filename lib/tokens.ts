/**
 * Single-use token primitives for invitations and password resets (PR010.2).
 *
 * SECURITY CONTRACT
 * -----------------
 * - The raw token is generated from `crypto.randomBytes` (32 bytes = 256 bits
 *   of entropy) and exists only in the URL handed to the user. It is NEVER
 *   persisted and NEVER logged.
 * - Only `sha256(raw)` reaches the database, so a dump of `Invitation` /
 *   `PasswordResetToken` cannot be replayed as a working link.
 * - Lookups are done by digest (`where: { tokenHash }`), which keeps the
 *   comparison inside Postgres' unique index instead of a per-row string
 *   compare in application code.
 * - Expiry is explicit and short: 30 minutes for a password reset (the §6
 *   contract), 7 days for an invitation.
 *
 * Pure `node:crypto` — no Prisma, no NextAuth, no network. Unit-testable.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** §6: "Token expira em 30 minutos." */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Invitations are a human workflow — a week is the operational default. */
export const INVITATION_TTL_DAYS = 7;

/** Bytes of entropy behind every token. */
export const TOKEN_BYTES = 32;

/** Generate a URL-safe, high-entropy raw token. */
export function generateToken(bytes: number = TOKEN_BYTES): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 digest (hex) of a raw token — the only form ever persisted. */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Constant-time digest comparison.
 *
 * Lookups go through the unique index on `tokenHash`, so this is a
 * defence-in-depth helper for the rare code path that compares two digests
 * in memory.
 */
export function safeCompareHash(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Absolute expiry `minutes` from `now`. */
export function expiresInMinutes(minutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

/** Absolute expiry `days` from `now`. */
export function expiresInDays(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60_000);
}

/** Expiry timestamp of a freshly issued password-reset token. */
export function passwordResetExpiry(now: Date = new Date()): Date {
  return expiresInMinutes(PASSWORD_RESET_TTL_MINUTES, now);
}

/** Expiry timestamp of a freshly issued invitation. */
export function invitationExpiry(now: Date = new Date()): Date {
  return expiresInDays(INVITATION_TTL_DAYS, now);
}

/**
 * Whether a token with this expiry is still valid at `now`.
 *
 * Exact-boundary policy: a token expiring at precisely `now` is EXPIRED.
 * Erring toward rejection is the safe direction for a credential.
 */
export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= now.getTime();
}

/** Minutes remaining before `expiresAt` (never negative). */
export function minutesUntil(expiresAt: Date, now: Date = new Date()): number {
  const diff = expiresAt.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / 60_000);
}
