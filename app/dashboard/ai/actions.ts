"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AuthorizationError } from "@/lib/rbac";
import { requireManager, requireOrganization, requireUser } from "@/lib/session";
import { aiMessageRepository } from "@/modules/ai/repositories/ai-message.repository";
import { readGeneratedContent } from "@/modules/ai/personalization/message.service";
import {
  readContextSnapshot,
  type ContextSnapshot,
} from "@/modules/ai/personalization/context-builder";
import { generateAiMessageSchema } from "@/modules/ai/validators/generate-message.validator";
import type { GeneratedMessageContent } from "@/modules/ai/openai/generator";

const PATH = "/dashboard/ai";

export interface AiActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

function fail(error: unknown): AiActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  console.error("[ai.actions]", error);
  return {
    ok: false,
    error: error instanceof Error ? error.message : "Não foi possível concluir a ação.",
  };
}

export interface GenerateAiMessageActionResult {
  id: string;
  cached: boolean;
  content: GeneratedMessageContent;
  promptVersion: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Server action: generate (or reuse a cached) personalized commercial
 * message for a creator/product/campaign/tone combination.
 *
 * SECURITY: this is the ONLY entry point into the AI Personalization
 * Engine reachable from the client. All OpenAI access happens inside
 * `modules/ai/*`, which this action calls server-side — the API key never
 * leaves the server, and no message is ever sent anywhere.
 */
export async function generateAiMessageAction(
  input: unknown,
): Promise<AiActionResult<GenerateAiMessageActionResult>> {
  try {
    const user = await requireManager();
    const data = generateAiMessageSchema.parse(input);

    const [creator, product, campaign, trend] = await Promise.all([
      prisma.creatorProfile.findFirst({
        where: { id: data.creatorId, organizationId: user.organizationId },
      }),
      prisma.product.findFirst({
        where: { id: data.productId, organizationId: user.organizationId },
      }),
      prisma.campaign.findFirst({
        where: { id: data.campaignId, organizationId: user.organizationId },
      }),
      prisma.trendSnapshot.findFirst({
        where: { organizationId: user.organizationId },
        orderBy: { trendScore: "desc" },
      }),
    ]);

    if (!creator || !product || !campaign) {
      throw new Error("Contexto de geração não encontrado neste workspace.");
    }

    // Lazily imported so the OpenAI-backed service (and, transitively, the
    // OpenAI client) is only ever loaded in this server action's module
    // graph — never reachable from a Client Component bundle.
    const { aiMessageService } = await import("@/modules/ai/personalization/message.service");

    const { message, cached } = await aiMessageService.generate(user.organizationId, {
      tone: data.tone,
      creatorUserId: user.id,
      creator: {
        id: creator.id,
        displayName: creator.displayName,
        handle: creator.handle,
        niche: creator.niche,
        engagementRate: creator.engagementRate,
        avgViews: creator.avgViews,
      },
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        priceCents: product.priceCents,
      },
      campaign: {
        id: campaign.id,
        name: campaign.name,
      },
      trend: trend
        ? {
            keyword: trend.keyword,
            category: trend.category,
            score: trend.trendScore,
          }
        : null,
    });

    revalidatePath(PATH);

    return {
      ok: true,
      data: {
        id: message.id,
        cached,
        content: readGeneratedContent(message),
        promptVersion: message.promptVersion,
        model: message.model,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
      },
    };
  } catch (error) {
    return fail(error);
  }
}

const messageIdSchema = z.string().trim().min(1);

/**
 * PR007.1 — AI Context Audit: everything the "Ver contexto" modal renders.
 *
 * `creator`/`product`/`campaign`/`trend` prefer the PERSISTED snapshot (the
 * audit truth of what the model saw); rows generated before PR007.1 have no
 * snapshot and fall back to the current related record names, flagged by
 * `snapshotAvailable: false`.
 */
export interface AiMessageContextActionResult {
  id: string;
  creator: string | null;
  product: string | null;
  campaign: string | null;
  trend: string | null;
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
  contextHash: string;
  snapshot: ContextSnapshot | null;
  snapshotAvailable: boolean;
}

/**
 * Server action (PR007.1): read the audited generation context for one
 * persisted AI message. Read-only and tenant-scoped — available to every
 * dashboard role that can already view /dashboard/ai (generation remains
 * MANAGER-only).
 */
export async function getAiMessageContextAction(
  id: string,
): Promise<AiActionResult<AiMessageContextActionResult>> {
  try {
    await requireUser();
    const organizationId = await requireOrganization();
    const messageId = messageIdSchema.parse(id);

    const message = await aiMessageRepository.findWithContext(organizationId, messageId);
    if (!message) {
      throw new Error("Mensagem não encontrada neste workspace.");
    }

    const snapshot = readContextSnapshot(message.contextSnapshot);

    return {
      ok: true,
      data: {
        id: message.id,
        creator: snapshot?.creator.name ?? message.creatorProfile.displayName,
        product: snapshot?.product.name ?? message.product.name,
        campaign: snapshot?.campaign.name ?? message.campaign.name,
        trend: snapshot?.trend?.keyword ?? null,
        promptVersion: message.promptVersion,
        model: message.model,
        temperature: message.temperature,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
        contextHash: message.contextHash,
        snapshot,
        snapshotAvailable: snapshot !== null,
      },
    };
  } catch (error) {
    return fail(error);
  }
}
