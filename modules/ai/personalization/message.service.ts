import "server-only";
import { createHash } from "node:crypto";
import type { AIGeneratedMessage, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import {
  createAiMessageRepository,
  type AiMessageDatabase,
} from "../repositories/ai-message.repository";
import { generatePersonalizedMessage, type GeneratedMessageContent } from "../openai/generator";
import { getPromptDefinition, type AiMessageTone } from "../openai/prompts";
import {
  buildPersonalizationContext,
  serializeContextForHash,
  type PersonalizationContextInput,
} from "./context-builder";

export interface GenerateAiMessageInput extends PersonalizationContextInput {
  tone: AiMessageTone;
  creatorUserId?: string | null;
  model?: string;
  temperature?: number;
}

export interface GenerateAiMessageResult {
  message: AIGeneratedMessage;
  /** `true` when an identical context was already cached and reused (no OpenAI call was made). */
  cached: boolean;
}

/**
 * Deterministic cache key for a (creator + product + campaign + tone +
 * promptVersion) tuple. Uses SHA-256 over a stable JSON serialization so the
 * same logical context always maps to the same `contextHash`, regardless of
 * property ordering.
 */
export function buildContextHash(
  input: PersonalizationContextInput,
  tone: AiMessageTone,
  promptVersion: string,
): string {
  const context = buildPersonalizationContext(input);
  const serialized = serializeContextForHash(context, promptVersion);
  return createHash("sha256").update(`${tone}:${serialized}`).digest("hex");
}

/**
 * Personalization service: orchestrates the context builder, the
 * OpenAI-backed generator, and the cache-aware repository.
 *
 * CACHE CONTRACT (PR007): an identical (creator + product + campaign +
 * promptVersion) context is never regenerated — a prior `AIGeneratedMessage`
 * row with the same `contextHash` is returned instead, and OpenAI is never
 * called again for it.
 *
 * This service never sends anything — it only generates and persists
 * versioned content.
 */
export function createAiMessageService(db: AiMessageDatabase) {
  const repo = createAiMessageRepository(db);

  return {
    async generate(
      organizationId: string,
      input: GenerateAiMessageInput,
    ): Promise<GenerateAiMessageResult> {
      const orgId = assertOrganizationId(organizationId);
      const context = buildPersonalizationContext(input);

      // The prompt version is a pure function of the tone (see
      // `openai/prompts.ts`), so the cache key can be computed before ever
      // calling OpenAI, letting us short-circuit on a cache hit.
      const promptVersion = getPromptDefinition(input.tone).version;
      const contextHash = buildContextHash(input, input.tone, promptVersion);

      const cached = await repo.findByContextHash(orgId, contextHash);
      if (cached) {
        return { message: cached, cached: true };
      }

      const generated = await generatePersonalizedMessage({
        tone: input.tone,
        context,
        model: input.model,
        temperature: input.temperature,
      });

      const created = await repo.create(orgId, {
        creatorUserId: input.creatorUserId ?? null,
        creatorProfileId: context.creator.id,
        productId: context.product.id,
        campaignId: context.campaign.id,
        tone: input.tone,
        promptVersion: generated.promptVersion,
        contextHash,
        model: generated.model,
        temperature: generated.temperature,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        content: generated.content as unknown as Prisma.InputJsonValue,
      });

      return { message: created, cached: false };
    },
  };
}

export const aiMessageService = createAiMessageService(prisma);

/** Type helper for reading a persisted message's structured content back out. */
export function readGeneratedContent(message: AIGeneratedMessage): GeneratedMessageContent {
  return message.content as unknown as GeneratedMessageContent;
}
