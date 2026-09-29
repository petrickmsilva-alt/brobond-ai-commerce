import "server-only";

import { z } from "zod";

export class AsyncInfrastructureError extends Error {
  readonly code = "ASYNC_INFRASTRUCTURE_UNAVAILABLE";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AsyncInfrastructureError";
  }
}

const asyncConfigSchema = z.object({
  REDIS_URL: z.string().url().optional(),
  REDIS_PREFIX: z.string().trim().min(1).default("brobond"),
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

export interface AsyncConfig {
  redisUrl: string;
  redisPrefix: string;
  concurrency: number;
}

export function getAsyncConfig(
  source: Record<string, string | undefined> = process.env,
): AsyncConfig {
  const parsed = asyncConfigSchema.safeParse(source);
  if (!parsed.success) {
    throw new AsyncInfrastructureError(
      `Invalid asynchronous runtime configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ")}`,
    );
  }
  if (!parsed.data.REDIS_URL) {
    throw new AsyncInfrastructureError(
      "REDIS_URL is required to enqueue jobs or start the asynchronous worker.",
    );
  }
  return {
    redisUrl: parsed.data.REDIS_URL,
    redisPrefix: parsed.data.REDIS_PREFIX,
    concurrency: parsed.data.QUEUE_CONCURRENCY,
  };
}
