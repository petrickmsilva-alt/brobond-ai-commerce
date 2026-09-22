"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import type { SchedulerJobResult } from "@/modules/trends/hunter/scheduler";
import { collectDailyTrendsJob } from "@/modules/trends/hunter/scheduler";
import { scoreTrend } from "@/modules/trends/hunter/scorer";
import type { TrendActionResult } from "@/modules/trends/dto/create-trend.dto";
import { trendRepository } from "@/modules/trends/repositories/trend.repository";
import { normalizeKeyword, trendSignalSchema } from "@/modules/trends/validators/trend.validator";

/**
 * Trend Hunter server actions — the ONLY write path from the UI to the
 * trends module.
 *
 * RBAC (enforced server-side on every action):
 *   ADMIN   → executar coleta · criar snapshot
 *   MANAGER → visualizar (no write actions available)
 *   MEMBER  → somente leitura (no write actions available)
 *
 * TENANT: `organizationId` always comes from the authenticated session
 * (`requireAdmin()` returns a guaranteed tenant) and is passed as the first
 * argument of every repository call. It is NEVER accepted from the client.
 *
 * The `trendScore` is ALWAYS computed server-side by the score engine — a
 * client-supplied score is never trusted.
 */

const TRENDS_PATH = "/dashboard/trends";

function fail(error: unknown): TrendActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos. Revise os campos destacados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  // Unique-constraint friendly message (tenant-scoped keyword/category collision).
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return { ok: false, error: "Já existe um registro equivalente para este workspace." };
  }
  console.error("[trends.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

/**
 * Execute the `collect-daily-trends` scheduler job (manual trigger — there
 * is no cron in PR002). ADMIN only.
 */
export async function collectDailyTrendsAction(): Promise<TrendActionResult<SchedulerJobResult>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: executa coleta
    const result = await collectDailyTrendsJob.execute(organizationId);
    if (result.status === "failed") {
      return {
        ok: false,
        error: `A coleta falhou: ${result.error ?? "erro desconhecido"}.`,
      };
    }
    revalidatePath(TRENDS_PATH);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Manually create one trend snapshot from a raw signal. ADMIN only.
 * The score is computed server-side by the score engine.
 */
export async function createTrendSnapshotAction(
  input: unknown,
): Promise<TrendActionResult<{ id: string; trendScore: number }>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: cria snapshot
    const signal = trendSignalSchema.parse(input);

    // Canonical keyword + server-side score — never trust the client.
    const scored = scoreTrend({ ...signal, keyword: normalizeKeyword(signal.keyword) });

    const snapshot = await trendRepository.createSnapshot(organizationId, {
      keyword: scored.keyword,
      category: scored.category,
      views: scored.views,
      likes: scored.likes,
      shares: scored.shares,
      trendScore: scored.trendScore,
    });

    // Keep the aggregate tables consistent with the new snapshot.
    await trendRepository.upsertKeyword(organizationId, scored.keyword, 1);
    await trendRepository.upsertCategory(organizationId, scored.category, scored.trendScore);

    revalidatePath(TRENDS_PATH);
    return { ok: true, data: { id: snapshot.id, trendScore: scored.trendScore } };
  } catch (error) {
    return fail(error);
  }
}
