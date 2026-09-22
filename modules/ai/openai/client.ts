import "server-only";

/**
 * OpenAI Responses API client — PR007 (AI Personalization Engine).
 *
 * DESIGN CONSTRAINTS (see PROJECT_STATE.md / PR007 spec)
 * -------------------------------------------------------
 * - Uses the OpenAI **Responses API** (`POST /v1/responses`) exclusively —
 *   no Chat Completions, no Assistants API.
 * - NO provider SDK. This module speaks the Responses API directly over
 *   `fetch`, mirroring the rest of the codebase's "no SDK" policy for
 *   external integrations (see `modules/outreach/prompts/generator.ts`,
 *   `modules/connectors/`). This keeps the dependency surface small and
 *   makes the network boundary auditable in one place.
 * - `import "server-only"` makes any accidental import from a Client
 *   Component fail the Next.js build instead of leaking `OPENAI_API_KEY`
 *   into the browser bundle.
 * - This module NEVER sends a message to a creator/customer. It only
 *   calls OpenAI to generate content that is persisted by
 *   `modules/ai/personalization/message.service.ts`.
 * - The single client instance lives here — no other module may call
 *   `fetch("https://api.openai.com/...")` directly.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAiConfigurationError extends Error {
  constructor(message = "OPENAI_API_KEY is not configured.") {
    super(message);
    this.name = "OpenAiConfigurationError";
  }
}

export class OpenAiRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "OpenAiRequestError";
    this.status = status;
  }
}

export interface OpenAiResponseRequest {
  /** System/developer instructions for the model. */
  instructions: string;
  /** The user-facing prompt (already fully interpolated — no template syntax here). */
  input: string;
  /** Defaults to `gpt-4o-mini` when omitted. */
  model?: string;
  /** Sampling temperature. Defaults to 0.7. */
  temperature?: number;
  /** Optional JSON Schema to force a structured output shape. */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface OpenAiResponseResult {
  /** Raw text produced by the model (already extracted from the Responses payload). */
  outputText: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === "") {
    throw new OpenAiConfigurationError();
  }
  return key;
}

/** Extract the assistant's plain-text output from a Responses API payload. */
export function extractOutputText(payload: unknown): string {
  if (payload && typeof payload === "object" && "output_text" in payload) {
    const text = (payload as { output_text?: unknown }).output_text;
    if (typeof text === "string") return text;
  }
  if (
    payload &&
    typeof payload === "object" &&
    "output" in payload &&
    Array.isArray((payload as { output?: unknown[] }).output)
  ) {
    const output = (payload as { output: unknown[] }).output;
    const chunks: string[] = [];
    for (const item of output) {
      if (
        item &&
        typeof item === "object" &&
        "content" in item &&
        Array.isArray((item as { content?: unknown[] }).content)
      ) {
        for (const content of (item as { content: unknown[] }).content) {
          if (
            content &&
            typeof content === "object" &&
            "text" in content &&
            typeof (content as { text?: unknown }).text === "string"
          ) {
            chunks.push((content as { text: string }).text);
          }
        }
      }
    }
    if (chunks.length > 0) return chunks.join("");
  }
  return "";
}

/**
 * Call the OpenAI Responses API and return the extracted text plus usage.
 *
 * Never called from a Client Component (enforced by `server-only` above and
 * the module boundary — only `modules/ai/openai/generator.ts` may import
 * this file).
 */
export async function callOpenAiResponses(
  request: OpenAiResponseRequest,
): Promise<OpenAiResponseResult> {
  const apiKey = getApiKey();
  const model = request.model ?? DEFAULT_MODEL;

  const body: Record<string, unknown> = {
    model,
    instructions: request.instructions,
    input: request.input,
    temperature: request.temperature ?? 0.7,
  };

  if (request.jsonSchema) {
    body.text = {
      format: {
        type: "json_schema",
        name: request.jsonSchema.name,
        schema: request.jsonSchema.schema,
        strict: true,
      },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new OpenAiRequestError(
      `OpenAI Responses API request failed (${response.status}): ${errorBody.slice(0, 500)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    model?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  return {
    outputText: extractOutputText(payload),
    model: payload.model ?? model,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
  };
}

export { DEFAULT_MODEL };
