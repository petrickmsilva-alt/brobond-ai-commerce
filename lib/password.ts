import bcrypt from "bcryptjs";

/**
 * Password hashing utilities.
 *
 * SECURITY CONTRACT
 * -----------------
 * - Passwords are NEVER stored, logged or transported in plaintext.
 * - Only the bcrypt digest (`User.passwordHash`) is persisted.
 * - `passwordHash` is never selected into anything that reaches a client
 *   component (see `lib/session.ts` / `lib/auth.ts` select lists).
 */

/** bcrypt cost factor. 12 ≈ ~250ms on commodity hardware in 2026. */
export const BCRYPT_COST = 12;

/**
 * Dummy hash used to equalize timing when an account does not exist or has no
 * password set, mitigating user-enumeration via response-time analysis.
 * It is a bcrypt digest of a random string and matches no real password.
 */
const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEe.RQVB8pPRTfQQ8Mmrs0/Npz7E3Uwd4/O";

/** Hash a plaintext password with bcrypt. */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error("Cannot hash an empty password.");
  return bcrypt.hash(plain, BCRYPT_COST);
}

/** Verify a plaintext password against a stored bcrypt digest. */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Burn roughly the same amount of CPU as a real verification.
 * Call this on the "user not found" / "no password set" branches so that the
 * authentication endpoint responds in constant time.
 */
export async function equalizeVerificationTiming(plain: string): Promise<void> {
  await verifyPassword(plain || "invalid", DUMMY_HASH);
}
