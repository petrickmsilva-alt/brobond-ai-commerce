import "server-only";

import type { PasswordResetToken, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import {
  PASSWORD_RESET_TTL_MINUTES,
  generateToken,
  hashToken,
  isExpired,
  passwordResetExpiry,
} from "@/lib/tokens";

/**
 * Password-reset domain (PR010.2 §6).
 *
 * FLOW: email → token → nova senha. Token expira em 30 minutos.
 *
 * SECURITY CONTRACT
 * -----------------
 * - NO USER ENUMERATION. `request()` returns the same shape whether or not
 *   the email exists. The caller therefore cannot use the reset form as an
 *   oracle to discover which addresses have accounts. This is why the return
 *   type carries `token: string | null` instead of throwing "unknown email".
 * - Only `sha256(token)` is persisted; the raw token lives in the emailed URL
 *   and is never written to the database or a log line.
 * - Single use: `consume()` marks `usedAt` inside the same transaction that
 *   rewrites `User.passwordHash`, so a replayed link cannot set the password
 *   twice.
 * - Issuing a new token invalidates every outstanding one for that user, so a
 *   leaked older link dies the moment the user asks for a fresh one.
 * - Redeeming a token also clears the user's other tokens — the classic
 *   "reset from two tabs" replay.
 * - The new password is bcrypt-hashed by `lib/password.ts`; plaintext is never
 *   stored.
 */

export type PasswordResetDatabase = Pick<PrismaClient, "passwordResetToken" | "user"> & {
  $transaction: PrismaClient["$transaction"];
};

export type PasswordResetRejection = "not_found" | "expired" | "used";

export class PasswordResetError extends Error {
  readonly reason: PasswordResetRejection;

  constructor(reason: PasswordResetRejection, message: string) {
    super(message);
    this.name = "PasswordResetError";
    this.reason = reason;
  }
}

/**
 * Outcome of a reset request.
 *
 * `token` is `null` when no account matched — the caller MUST still report
 * success to the user. `email` is echoed only so the delivery layer can
 * address the message; it is never returned to the browser.
 */
export interface PasswordResetRequestResult {
  /** Raw token, or `null` when the email has no (password-capable) account. */
  token: string | null;
  email: string;
  expiresAt: Date | null;
}

export const RESET_TTL_MINUTES = PASSWORD_RESET_TTL_MINUTES;

export function createPasswordResetService(db: PasswordResetDatabase) {
  /** Resolve a raw token to a live reset record, or throw a typed rejection. */
  async function resolveToken(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<PasswordResetToken> {
    const tokenHash = hashToken(rawToken);
    const record = await db.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record) {
      throw new PasswordResetError("not_found", "Link de recuperação inválido.");
    }
    if (record.usedAt) {
      throw new PasswordResetError("used", "Este link já foi utilizado.");
    }
    if (isExpired(record.expiresAt, now)) {
      throw new PasswordResetError("expired", "Este link expirou. Solicite um novo.");
    }
    return record;
  }

  return {
    resolveToken,

    /**
     * Issue a reset token for `email`, if such an account exists.
     *
     * Always resolves — never throws for an unknown address — so the caller
     * can return one indistinguishable response either way.
     */
    async request(email: string, now: Date = new Date()): Promise<PasswordResetRequestResult> {
      const normalized = email.trim().toLowerCase();

      const user = await db.user.findUnique({
        where: { email: normalized },
        select: { id: true },
      });

      // Unknown account: report nothing, write nothing.
      if (!user) return { token: null, email: normalized, expiresAt: null };

      const token = generateToken();
      const tokenHash = hashToken(token);
      const expiresAt = passwordResetExpiry(now);

      // Invalidate every outstanding token before issuing the new one.
      await db.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await db.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt },
      });

      return { token, email: normalized, expiresAt };
    },

    /** Whether a raw token is currently redeemable (used by the reset page). */
    async isValid(rawToken: string, now: Date = new Date()): Promise<boolean> {
      try {
        await resolveToken(rawToken, now);
        return true;
      } catch {
        return false;
      }
    },

    /**
     * Redeem a token and set the new password.
     *
     * Atomic: the token is consumed with a `usedAt IS NULL` guard in the same
     * transaction as the password write, so two concurrent redemptions cannot
     * both succeed.
     */
    async consume(
      rawToken: string,
      newPassword: string,
      now: Date = new Date(),
    ): Promise<{ userId: string; email: string }> {
      const record = await resolveToken(rawToken, now);
      const passwordHash = await hashPassword(newPassword);

      return db.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: now },
        });
        if (claimed.count === 0) {
          throw new PasswordResetError("used", "Este link já foi utilizado.");
        }

        const user = await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash },
          select: { id: true, email: true },
        });

        // Any sibling token is now dead weight — and a replay risk.
        await tx.passwordResetToken.deleteMany({
          where: { userId: record.userId, usedAt: null },
        });

        return { userId: user.id, email: user.email };
      });
    },
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;

/** Production instance bound to the shared Prisma client. */
export const passwordResetService = createPasswordResetService(prisma);
