/**
 * AI provider integration — INTERFACE ONLY (reserved for PR003).
 *
 * PR000 deliberately does NOT implement OpenAI or any AI provider. This
 * file defines the contract only.
 */

export interface AiCompletionRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
}

export interface AiProvider {
  /** Generate a text completion. NOT IMPLEMENTED in PR000. */
  complete(request: AiCompletionRequest): Promise<string>;
}

const NOT_IMPLEMENTED = "AI provider is not implemented in PR000 (reserved for PR003).";

export function createAiProvider(): AiProvider {
  return {
    complete() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
