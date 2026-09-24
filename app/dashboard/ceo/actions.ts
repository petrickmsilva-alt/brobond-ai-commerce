"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin, requireManager } from "@/lib/session";
import { InvalidDecisionTransitionError } from "@/modules/ai-ceo/engine/decision.engine";
import { DecisionNotFoundError } from "@/modules/ai-ceo/repositories/ai-ceo.repository";
import { aiCeoService } from "@/modules/ai-ceo/services/ai-ceo.service";
import { decisionTransitionSchema } from "@/modules/ai-ceo/validators";

const PATH = "/dashboard/ceo";

export interface AICeoActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}

function fail(error: unknown): AICeoActionResult<never> {
  if (error instanceof z.ZodError) return { ok: false, error: "Dados inválidos." };
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para esta ação executiva." };
  }
  if (error instanceof InvalidDecisionTransitionError) {
    return { ok: false, error: "Transição inválida para o estado atual da decisão." };
  }
  if (error instanceof DecisionNotFoundError) {
    return { ok: false, error: "Decisão não encontrada neste workspace." };
  }
  console.error("[ai-ceo.actions]", error instanceof Error ? error.message : "unexpected error");
  return { ok: false, error: "Não foi possível concluir a operação do AI CEO." };
}

/** MANAGER+: analyze the current operation and persist advisory PENDING decisions. */
export async function generateExecutiveDecisionsAction(): Promise<
  AICeoActionResult<{ runId: string; opportunities: number; decisions: number }>
> {
  try {
    const user = await requireManager();
    const result = await aiCeoService.generateExecutiveDecisions(user.organizationId, user.id);
    revalidatePath(PATH);
    return {
      ok: true,
      data: {
        runId: result.runId,
        opportunities: result.opportunities,
        decisions: result.decisions,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/** MANAGER+: generate and persist today's versioned executive report. */
export async function generateExecutiveReportAction(): Promise<
  AICeoActionResult<{ reportId: string }>
> {
  try {
    const user = await requireManager();
    const report = await aiCeoService.generateExecutiveReport(user.organizationId, user.id);
    revalidatePath(PATH);
    return { ok: true, data: { reportId: report.id } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * ADMIN only. APPROVED/REJECTED/EXECUTED are audit transitions only;
 * EXECUTED confirms an external human action and dispatches nothing.
 */
export async function transitionExecutiveDecisionAction(
  input: unknown,
): Promise<AICeoActionResult<{ decisionId: string; status: string }>> {
  try {
    const user = await requireAdmin();
    const parsed = decisionTransitionSchema.parse(input);
    const decision = await aiCeoService.transitionDecision(
      user.organizationId,
      parsed.decisionId,
      parsed.status,
      user.id,
    );
    revalidatePath(PATH);
    return { ok: true, data: { decisionId: decision.id, status: decision.status } };
  } catch (error) {
    return fail(error);
  }
}
