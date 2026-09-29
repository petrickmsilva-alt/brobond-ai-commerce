"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin, requireManager } from "@/lib/session";
import {
  canTransitionCreatorStatus,
  type CreatorStatusName,
} from "@/modules/creators/interfaces/creator.interface";
import type { CreatorActionResult } from "@/modules/creators/crm/dto/creator.dto";
import { toCreateCreatorDTO } from "@/modules/creators/crm/dto/creator.dto";
import { creatorRepository } from "@/modules/creators/crm/repositories/creator-profile.repository";
import {
  changeCreatorStatusSchema,
  createCreatorSchema,
  normalizeHandle,
} from "@/modules/creators/crm/validators/creator.validator";
import { calculateCreatorScore } from "@/modules/creators/discovery/scorer";
import type { CreatorJobResult } from "@/modules/creators/discovery/scheduler";
import { discoverCreatorsJob } from "@/modules/creators/discovery/scheduler";

/**
 * Creator CRM server actions — the ONLY write path from the UI to the
 * creators module.
 *
 * RBAC (enforced server-side on every action):
 *   ADMIN   → executar descoberta · criar profile · mover pipeline
 *   MANAGER → criar profile · mover pipeline
 *   MEMBER  → somente leitura (no write actions available)
 *
 * TENANT: `organizationId` always comes from the authenticated session
 * (`requireAdmin()`/`requireManager()` return a guaranteed tenant) and is
 * passed as the first argument of every repository call. It is NEVER
 * accepted from the client.
 *
 * The `creatorScore` is ALWAYS computed server-side by the score engine —
 * a client-supplied score is never trusted. Pipeline moves are validated
 * against the transition map before anything is persisted.
 */

const CREATORS_PATH = "/dashboard/creators";

function fail(error: unknown): CreatorActionResult<never> {
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
  // Unique-constraint friendly message (tenant-scoped handle collision).
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return { ok: false, error: "Já existe um creator com este handle neste workspace." };
  }
  console.error("[creators.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

/**
 * Execute the `discover-creators` scheduler job (manual trigger — there is
 * no cron in PR003). ADMIN only.
 */
export async function discoverCreatorsAction(): Promise<CreatorActionResult<CreatorJobResult>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: executa descoberta
    const result = await discoverCreatorsJob.execute(organizationId);
    if (result.status === "failed") {
      return {
        ok: false,
        error: `A descoberta falhou: ${result.error ?? "erro desconhecido"}.`,
      };
    }
    revalidatePath(CREATORS_PATH);
    return { ok: true, data: result };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Manually add one creator profile to the CRM. MANAGER+.
 * The profile is stamped with `source: MANUAL` and `status: NEW` — a form
 * may never mint a discovered or qualified profile. The score is computed
 * server-side from the metrics the operator supplied.
 */
export async function createCreatorAction(
  input: unknown,
): Promise<CreatorActionResult<{ id: string; handle: string; creatorScore: number }>> {
  try {
    const { organizationId } = await requireManager(); // MANAGER+: cria profile
    const parsed = createCreatorSchema.parse(input);

    // Server-side score — never trust the client. Unknown components
    // score 0; the niche is a deliberate human choice, so it matches in
    // full against the tracked vocabulary.
    const creatorScore = calculateCreatorScore({
      engagementRate: parsed.engagementRate,
      postsPerWeek: 0,
      nicheMatch: 100,
      growthRate: 0,
      qualityScore: 0,
    });

    const creator = await creatorRepository.createCreator(
      organizationId,
      toCreateCreatorDTO(parsed, creatorScore),
    );

    for (const tag of parsed.tags ?? []) {
      await creatorRepository.addTag(organizationId, creator.id, tag);
    }

    revalidatePath(CREATORS_PATH);
    return {
      ok: true,
      data: {
        id: creator.id,
        handle: normalizeHandle(creator.handle),
        creatorScore: creator.creatorScore,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Move a profile along the CRM pipeline. MANAGER+.
 * The transition is validated against `CREATOR_STATUS_TRANSITIONS` —
 * illegal jumps (e.g. NEW → ACTIVE) are rejected before any write.
 */
export async function changeCreatorStatusAction(
  input: unknown,
): Promise<CreatorActionResult<{ id: string; status: CreatorStatusName }>> {
  try {
    const { organizationId } = await requireManager(); // MANAGER+: move pipeline
    const { id, status } = changeCreatorStatusSchema.parse(input);

    const creator = await creatorRepository.findById(organizationId, id);
    if (!creator) {
      return { ok: false, error: "Creator não encontrado neste workspace." };
    }

    const from = creator.status as CreatorStatusName;
    if (!canTransitionCreatorStatus(from, status)) {
      return {
        ok: false,
        error: `Transição inválida: ${from} → ${status}. Use o pipeline passo a passo.`,
      };
    }

    const updated = await creatorRepository.changeStatus(organizationId, id, status);
    if (!updated) {
      return { ok: false, error: "Creator não encontrado neste workspace." };
    }

    revalidatePath(CREATORS_PATH);
    return { ok: true, data: { id: updated.id, status: updated.status as CreatorStatusName } };
  } catch (error) {
    return fail(error);
  }
}
