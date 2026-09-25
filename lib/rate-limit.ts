import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Login brute-force protection (PR011.1).
 *
 * Backed by the `RateLimit` table (tenant-agnostic by design: login happens
 * BEFORE a session/tenant exists, so the identifier is the login email).
 *
 * - MAX_ATTEMPTS: failed attempts before the identifier is locked.
 * - LOCK_WINDOW_MINUTES: sliding window counting consecutive failures.
 * - LOCK_DURATION_MINUTES: how long an active lock lasts.
 *
 * The identifier is the login email (lowercased). IP-based limiting would
 * require request-header access inside `authorize()` and is intentionally
 * out of scope for this first cut — tracked as a follow-up.
 */
const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;
const LOCK_DURATION_MINUTES = 15;

const LOCK_WINDOW_MS = LOCK_WINDOW_MINUTES * 60 * 1000;
const LOCK_DURATION_MS = LOCK_DURATION_MINUTES * 60 * 1000;

/** Exported for tests — the policy constants behind the lockout. */
export const RATE_LIMIT_POLICY = {
  maxAttempts: MAX_ATTEMPTS,
  lockWindowMinutes: LOCK_WINDOW_MINUTES,
  lockDurationMinutes: LOCK_DURATION_MINUTES,
} as const;

export async function isRateLimited(identifier: string): Promise<boolean> {
  const normalized = identifier.toLowerCase();
  const now = new Date();

  const record = await prisma.rateLimit.findUnique({
    where: { identifier_type: { identifier: normalized, type: "login" } },
  });

  if (!record) return false;

  // Bloqueio ativo e não expirado
  if (record.lockedAt) {
    if (now < new Date(record.lockedAt.getTime() + LOCK_DURATION_MS)) {
      return true;
    }
    // Bloqueio expirou: reset
    await prisma.rateLimit.update({
      where: { identifier_type: { identifier: normalized, type: "login" } },
      data: { attempts: 0, lockedAt: null, updatedAt: now },
    });
    return false;
  }

  // Janela deslizante: se a última atualização é antiga demais, reset
  if (record.updatedAt < new Date(now.getTime() - LOCK_WINDOW_MS)) {
    await prisma.rateLimit.update({
      where: { identifier_type: { identifier: normalized, type: "login" } },
      data: { attempts: 0, updatedAt: now },
    });
    return false;
  }

  return record.attempts >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(identifier: string): Promise<void> {
  const normalized = identifier.toLowerCase();
  const now = new Date();

  const record = await prisma.rateLimit.findUnique({
    where: { identifier_type: { identifier: normalized, type: "login" } },
  });

  if (!record || record.updatedAt < new Date(now.getTime() - LOCK_WINDOW_MS)) {
    // Novo registro ou janela expirada: cria/reseta
    await prisma.rateLimit.upsert({
      where: { identifier_type: { identifier: normalized, type: "login" } },
      create: { identifier: normalized, type: "login", attempts: 1, updatedAt: now },
      update: { attempts: 1, updatedAt: now },
    });
    return;
  }

  // Incrementa no registro existente dentro da janela
  const newAttempts = record.attempts + 1;
  await prisma.rateLimit.update({
    where: { identifier_type: { identifier: normalized, type: "login" } },
    data: {
      attempts: newAttempts,
      updatedAt: now,
      lockedAt: newAttempts >= MAX_ATTEMPTS ? now : null,
    },
  });
}

export async function resetFailedAttempts(identifier: string): Promise<void> {
  const normalized = identifier.toLowerCase();
  await prisma.rateLimit.updateMany({
    where: { identifier: normalized, type: "login" },
    data: { attempts: 0, lockedAt: null, updatedAt: new Date() },
  });
}
