"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireManager } from "@/lib/session";
import type { MatchActionResult } from "@/modules/campaigns/dto/product-match.dto";
import { productMatchRepository } from "@/modules/campaigns/repositories/product-match.repository";
import {
  approveProductMatchSchema,
  createProductMatchSchema,
  removeProductMatchSchema,
} from "@/modules/campaigns/validators/product-match.validator";

/**
 * Product Match server actions — the ONLY write path from the UI to the
 * matches layer (PR005.1).
 *
 * RBAC (enforced server-side on every action):
 *   ADMIN   → criar · aprovar · remover
 *   MANAGER → criar · aprovar · remover
 *   MEMBER  → somente leitura (no write actions available)
 *
 * TENANT: `organizationId` always comes from the authenticated session
 * (`requireManager()` returns a guaranteed tenant) and is passed as the
 * first argument of every repository call. It is NEVER accepted from the
 * client.
 *
 * Deterministic matching only: these actions never call an AI provider,
 * never analyze video frames and never compute embeddings.
 */

const MATCHES_PATH = "/dashboard/matches";

function fail(error: unknown): MatchActionResult<never> {
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
  // Unique-constraint friendly message (content/product pair already matched).
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return { ok: false, error: "Este conteúdo já está vinculado a este produto." };
  }
  console.error("[matches.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

/**
 * Manually create one match between an imported content and a product.
 * MANAGER or above (MEMBER is read-only). The repository refuses content
 * or product ids that do not belong to the caller's tenant.
 */
export async function createProductMatch(
  input: unknown,
): Promise<MatchActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager(); // ADMIN+MANAGER: cria
    const data = createProductMatchSchema.parse(input);

    const match = await productMatchRepository.createMatch(organizationId, data);
    if (!match) {
      return { ok: false, error: "Conteúdo ou produto não encontrado neste workspace." };
    }

    revalidatePath(MATCHES_PATH);
    return { ok: true, data: { id: match.id } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Approve one automatic (AI/RULE) match: promotes it to MANUAL with full
 * confidence — the human word is definitive. MANAGER or above.
 */
export async function approveMatch(
  input: unknown,
): Promise<MatchActionResult<{ id: string; confidence: number }>> {
  try {
    const { organizationId } = await requireManager(); // ADMIN+MANAGER: aprova
    const { matchId } = approveProductMatchSchema.parse(input);

    const match = await productMatchRepository.approveMatch(organizationId, matchId);
    if (!match) {
      return { ok: false, error: "Match não encontrado neste workspace." };
    }

    revalidatePath(MATCHES_PATH);
    return { ok: true, data: { id: match.id, confidence: match.confidence } };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Remove one match. MANAGER or above (MEMBER is read-only). The delete is
 * tenant-scoped — a foreign id removes nothing and reports failure.
 */
export async function removeMatch(input: unknown): Promise<MatchActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager(); // ADMIN+MANAGER: remove
    const { matchId } = removeProductMatchSchema.parse(input);

    const removed = await productMatchRepository.deleteMatch(organizationId, matchId);
    if (!removed) {
      return { ok: false, error: "Match não encontrado neste workspace." };
    }

    revalidatePath(MATCHES_PATH);
    return { ok: true, data: { id: matchId } };
  } catch (error) {
    return fail(error);
  }
}
