import "server-only";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import type { Prisma } from "@prisma/client";

const MAX_ATTEMPTS = 5;
const LOCK_WINDOW_MINUTES = 15;
const LOCK_DURATION_MINUTES = 15;

const LOCK_WINDOW_MS = LOCK_WINDOW_MINUTES * 60 * 1000;
const LOCK_DURATION_MS = LOCK_DURATION_MINUTES * 60 * 1000;

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

  // Janela deslizante: se a última atualização é antigas demais, reset
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
