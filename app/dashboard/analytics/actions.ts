"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireManager } from "@/lib/session";
import { analyticsService } from "@/modules/analytics/services/analytics.service";
import { refreshAnalyticsSchema } from "@/modules/analytics/validators/analytics.validator";

const PATH = "/dashboard/analytics";

export interface AnalyticsActionResult {
  ok: boolean;
  error?: string;
  computedAt?: string;
}

function fail(error: unknown): AnalyticsActionResult {
  if (error instanceof z.ZodError) {
    return { ok: false, error: "Dados inválidos." };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  console.error("[analytics.actions]", error);
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
  };
}

/**
 * Server action (PR008): force recomputation of the current period's
 * analytics snapshot for the caller's tenant. MANAGER+ only; the tenant
 * always comes from the session — never from the client.
 */
export async function refreshAnalyticsAction(input: unknown): Promise<AnalyticsActionResult> {
  try {
    const user = await requireManager();
    const data = refreshAnalyticsSchema.parse(input ?? {});

    const dashboard = await analyticsService.refresh(user.organizationId, {
      days: data.days,
    });

    revalidatePath(PATH);
    return { ok: true, computedAt: dashboard.computedAt };
  } catch (error) {
    return fail(error);
  }
}
