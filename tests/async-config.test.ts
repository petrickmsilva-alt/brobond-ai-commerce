import { describe, expect, it } from "vitest";
import { AsyncInfrastructureError, getAsyncConfig } from "@/lib/async/config";

describe("async infrastructure configuration", () => {
  it("fails explicitly when Redis is absent", () => {
    expect(() => getAsyncConfig({})).toThrow(AsyncInfrastructureError);
  });

  it("validates and normalizes Redis worker configuration", () => {
    expect(
      getAsyncConfig({
        REDIS_URL: "redis://localhost:6379",
        REDIS_PREFIX: "tenant-jobs",
        QUEUE_CONCURRENCY: "8",
      }),
    ).toEqual({
      redisUrl: "redis://localhost:6379",
      redisPrefix: "tenant-jobs",
      concurrency: 8,
    });
  });
});
