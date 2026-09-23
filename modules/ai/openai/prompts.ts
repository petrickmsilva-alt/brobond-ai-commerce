/**
 * Versioned prompt catalog — PR007 (AI Personalization Engine).
 *
 * Exactly 5 tones are supported, matching the `AiMessageTone` Prisma enum:
 * FRIENDLY, PREMIUM, LUXURY, STREET, FITNESS.
 *
 * Every prompt carries an explicit semantic version (`friendly@1.0.0`, …).
 * The version string is persisted on `AIGeneratedMessage.promptVersion` and
 * is part of the cache key (see `message.service.ts`), so bumping a
 * template's copy MUST bump its version — otherwise stale cached content
 * for the same creator/product/campaign tuple would silently keep being
 * served under the old wording.
 *
 * This module is pure string templating: no network call, no Prisma
 * import, no `server-only` guard needed (it holds no secret), but it is
 * only ever invoked from `modules/ai/openai/generator.ts` which does run
 * server-side.
 */

import type { PersonalizationContext } from "../personalization/context-builder";

export const AI_MESSAGE_TONES = ["FRIENDLY", "PREMIUM", "LUXURY", "STREET", "FITNESS"] as const;

export type AiMessageTone = (typeof AI_MESSAGE_TONES)[number];

export interface PromptDefinition {
  tone: AiMessageTone;
  /** Semantic version of this template's wording — bump on any copy change. */
  version: string;
  /** System/developer instructions sent as `instructions` to the Responses API. */
  instructions: string;
}

/** JSON Schema enforced on the model's structured output via the Responses API. */
export const AI_MESSAGE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    message: { type: "string" },
    hashtags: {
      type: "array",
      items: { type: "string" },
    },
    cta: { type: "string" },
  },
  required: ["title", "message", "hashtags", "cta"],
} as const;

const PROMPT_DEFINITIONS: Record<AiMessageTone, PromptDefinition> = {
  FRIENDLY: {
    tone: "FRIENDLY",
    version: "friendly@1.0.0",
    instructions:
      "Você é um redator de marketing de influência brasileiro. Escreva em um tom " +
      "amigável, próximo e caloroso, como uma conversa entre amigos. Use uma " +
      "linguagem simples, acolhedora e emojis com moderação. Nunca envie a " +
      "mensagem — apenas gere o conteúdo. Responda estritamente no formato JSON " +
      "solicitado, com os campos title, message, hashtags (array de strings " +
      "começando com #) e cta.",
  },
  PREMIUM: {
    tone: "PREMIUM",
    version: "premium@1.0.0",
    instructions:
      "Você é um redator de marketing de influência brasileiro especializado em " +
      "marcas premium. Escreva em um tom sofisticado, confiante e aspiracional, " +
      "destacando qualidade e exclusividade sem exageros. Nunca envie a " +
      "mensagem — apenas gere o conteúdo. Responda estritamente no formato JSON " +
      "solicitado, com os campos title, message, hashtags (array de strings " +
      "começando com #) e cta.",
  },
  LUXURY: {
    tone: "LUXURY",
    version: "luxury@1.0.0",
    instructions:
      "Você é um redator de marketing de influência brasileiro especializado em " +
      "produtos de luxo. Escreva em um tom elegante, refinado e exclusivo, " +
      "evocando status e desejo, com vocabulário elevado e discreto. Nunca envie " +
      "a mensagem — apenas gere o conteúdo. Responda estritamente no formato " +
      "JSON solicitado, com os campos title, message, hashtags (array de " +
      "strings começando com #) e cta.",
  },
  STREET: {
    tone: "STREET",
    version: "street@1.0.0",
    instructions:
      "Você é um redator de marketing de influência brasileiro especializado em " +
      "cultura urbana e streetwear. Escreva em um tom autêntico, direto e " +
      "descolado, usando gírias atuais com moderação e energia jovem. Nunca " +
      "envie a mensagem — apenas gere o conteúdo. Responda estritamente no " +
      "formato JSON solicitado, com os campos title, message, hashtags (array " +
      "de strings começando com #) e cta.",
  },
  FITNESS: {
    tone: "FITNESS",
    version: "fitness@1.0.0",
    instructions:
      "Você é um redator de marketing de influência brasileiro especializado em " +
      "fitness e bem-estar. Escreva em um tom motivador, enérgico e positivo, " +
      "incentivando ação e superação. Nunca envie a mensagem — apenas gere o " +
      "conteúdo. Responda estritamente no formato JSON solicitado, com os " +
      "campos title, message, hashtags (array de strings começando com #) e " +
      "cta.",
  },
};

/** Look up the versioned prompt definition for a given tone. */
export function getPromptDefinition(tone: AiMessageTone): PromptDefinition {
  const definition = PROMPT_DEFINITIONS[tone];
  if (!definition) {
    throw new RangeError(`Unknown AI message tone: ${String(tone)}`);
  }
  return definition;
}

/** All 5 prompt definitions, in enum-declaration order — used for tests/audits. */
export function listPromptDefinitions(): readonly PromptDefinition[] {
  return AI_MESSAGE_TONES.map((tone) => PROMPT_DEFINITIONS[tone]);
}

/** Render the user-facing `input` payload sent alongside `instructions`. */
export function buildPromptInput(context: PersonalizationContext): string {
  const lines = [
    `Criador(a): ${context.creator.name} (@${context.creator.handle})`,
    `Nicho: ${context.creator.niche}`,
    `Engajamento médio: ${context.creator.engagementRate}%`,
    `Visualizações médias: ${context.creator.avgViews}`,
    `Produto: ${context.product.name}`,
  ];
  if (context.product.description) {
    lines.push(`Descrição do produto: ${context.product.description}`);
  }
  lines.push(`Campanha: ${context.campaign.name}`);
  if (context.campaign.goal) {
    lines.push(`Objetivo da campanha: ${context.campaign.goal}`);
  }
  if (context.trend) {
    lines.push(`Tendência relevante: ${context.trend.keyword}`);
    if (context.trend.category) {
      lines.push(`Categoria da tendência: ${context.trend.category}`);
    }
  }
  lines.push(
    "Gere uma mensagem comercial personalizada para esta parceria, no formato JSON com os campos: title, message, hashtags, cta.",
  );
  return lines.join("\n");
}
