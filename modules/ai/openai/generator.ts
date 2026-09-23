import "server-only";

import { callOpenAiResponses, DEFAULT_MODEL } from "./client";
import {
  AI_MESSAGE_OUTPUT_SCHEMA,
  buildPromptInput,
  getPromptDefinition,
  type AiMessageTone,
} from "./prompts";
import type { PersonalizationContext } from "../personalization/context-builder";

/** The structured content every generated message must contain. */
export interface GeneratedMessageContent {
  title: string;
  message: string;
  hashtags: string[];
  cta: string;
}

export interface GeneratePersonalizedMessageInput {
  tone: AiMessageTone;
  context: PersonalizationContext;
  model?: string;
  temperature?: number;
}

export interface GeneratePersonalizedMessageResult {
  content: GeneratedMessageContent;
  promptVersion: string;
  model: string;
  temperature: number;
  inputTokens: number;
  outputTokens: number;
}

export class GeneratedContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeneratedContentValidationError";
  }
}

/** Validate + coerce the raw model JSON into the required `{ title, message, hashtags, cta }` shape. */
export function parseGeneratedContent(raw: string): GeneratedMessageContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GeneratedContentValidationError("OpenAI response was not valid JSON.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new GeneratedContentValidationError("OpenAI response was not a JSON object.");
  }

  const obj = parsed as Record<string, unknown>;
  const { title, message, hashtags, cta } = obj;

  if (typeof title !== "string" || title.trim() === "") {
    throw new GeneratedContentValidationError("Missing or invalid 'title' field.");
  }
  if (typeof message !== "string" || message.trim() === "") {
    throw new GeneratedContentValidationError("Missing or invalid 'message' field.");
  }
  if (typeof cta !== "string" || cta.trim() === "") {
    throw new GeneratedContentValidationError("Missing or invalid 'cta' field.");
  }
  if (!Array.isArray(hashtags) || !hashtags.every((tag) => typeof tag === "string")) {
    throw new GeneratedContentValidationError("Missing or invalid 'hashtags' field.");
  }

  return { title, message, hashtags, cta };
}

/**
 * Generate a personalized commercial message via the OpenAI Responses API.
 *
 * Returns `{ title, message, hashtags, cta }` alongside token usage and the
 * prompt version used, so the caller (`message.service.ts`) can persist an
 * `AIGeneratedMessage` row. This function NEVER sends anything anywhere —
 * it only produces content.
 */
export async function generatePersonalizedMessage(
  input: GeneratePersonalizedMessageInput,
): Promise<GeneratePersonalizedMessageResult> {
  const prompt = getPromptDefinition(input.tone);
  const promptInput = buildPromptInput(input.context);
  const temperature = input.temperature ?? 0.7;
  const model = input.model ?? DEFAULT_MODEL;

  const response = await callOpenAiResponses({
    instructions: prompt.instructions,
    input: promptInput,
    model,
    temperature,
    jsonSchema: {
      name: "ai_generated_message",
      schema: AI_MESSAGE_OUTPUT_SCHEMA,
    },
  });

  const content = parseGeneratedContent(response.outputText);

  return {
    content,
    promptVersion: prompt.version,
    model: response.model,
    temperature,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  };
}
