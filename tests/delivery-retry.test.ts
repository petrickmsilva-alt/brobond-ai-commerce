import { describe, expect, it } from "vitest";
import {
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_RETRY_BASE_MS,
  DELIVERY_RETRY_MAX_DELAY_MS,
  computeNextAttemptAt,
  computeRetryDelayMs,
  decideRetry,
  isRetryExhausted,
  isRetryableError,
  sanitizeAttemptError,
} from "@/modules/delivery/queue/retry.service";
import { DeliveryProviderError } from "@/modules/delivery/core/delivery.interface";
import { DeliveryAccountUnavailableError } from "@/modules/delivery/queue/dispatcher";

const NOW = new Date("2026-09-23T12:00:00.000Z");

describe("Retry engine contract (PR010)", () => {
  it("the attempt budget is exactly 3", () => {
    expect(DELIVERY_MAX_ATTEMPTS).toBe(3);
  });

  it("backoff is exponential with base 1s", () => {
    expect(DELIVERY_RETRY_BASE_MS).toBe(1_000);
    expect(computeRetryDelayMs(1)).toBe(1_000);
    expect(computeRetryDelayMs(2)).toBe(2_000);
  });

  it("backoff is capped instead of growing unbounded", () => {
    expect(computeRetryDelayMs(20)).toBe(DELIVERY_RETRY_MAX_DELAY_MS);
    expect(computeRetryDelayMs(6)).toBeLessThanOrEqual(DELIVERY_RETRY_MAX_DELAY_MS);
  });

  it("backoff is deterministic (same input → same delay)", () => {
    expect(computeRetryDelayMs(2)).toBe(computeRetryDelayMs(2));
    expect(computeNextAttemptAt(NOW, 1)?.getTime()).toBe(NOW.getTime() + 1_000);
  });

  it("handles degenerate inputs defensively", () => {
    expect(computeRetryDelayMs(0)).toBe(DELIVERY_RETRY_BASE_MS);
    expect(computeRetryDelayMs(-5)).toBe(DELIVERY_RETRY_BASE_MS);
    expect(computeRetryDelayMs(1.5)).toBe(DELIVERY_RETRY_BASE_MS);
    expect(computeRetryDelayMs(Number.NaN)).toBe(DELIVERY_RETRY_BASE_MS);
  });

  it("isRetryExhausted flips exactly at the budget", () => {
    expect(isRetryExhausted(0)).toBe(false);
    expect(isRetryExhausted(1)).toBe(false);
    expect(isRetryExhausted(2)).toBe(false);
    expect(isRetryExhausted(3)).toBe(true);
    expect(isRetryExhausted(4)).toBe(true);
  });

  it("computeNextAttemptAt returns a deadline while budget remains", () => {
    expect(computeNextAttemptAt(NOW, 1)?.toISOString()).toBe("2026-09-23T12:00:01.000Z");
    expect(computeNextAttemptAt(NOW, 2)?.toISOString()).toBe("2026-09-23T12:00:02.000Z");
  });

  it("computeNextAttemptAt returns null once exhausted", () => {
    expect(computeNextAttemptAt(NOW, 3)).toBeNull();
    expect(computeNextAttemptAt(NOW, 9)).toBeNull();
  });
});

describe("isRetryableError", () => {
  it("retryable provider errors may retry", () => {
    expect(isRetryableError(new DeliveryProviderError("z", { status: 500 }))).toBe(true);
    expect(isRetryableError(new DeliveryProviderError("z", { status: 429 }))).toBe(true);
    expect(isRetryableError(new DeliveryProviderError("z", { status: 408 }))).toBe(true);
  });

  it("permanent provider errors must not retry", () => {
    expect(isRetryableError(new DeliveryProviderError("z", { status: 400 }))).toBe(false);
    expect(isRetryableError(new DeliveryProviderError("z", { status: 401 }))).toBe(false);
    expect(isRetryableError(new DeliveryProviderError("z", { status: 403 }))).toBe(false);
  });

  it("a missing connected account IS retryable (ADMIN may connect it)", () => {
    expect(isRetryableError(new DeliveryAccountUnavailableError())).toBe(true);
  });

  it("generic errors are treated as permanent", () => {
    expect(isRetryableError(new Error("boom"))).toBe(false);
    expect(isRetryableError(new TypeError("bad"))).toBe(false);
    expect(isRetryableError("string failure")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe("decideRetry", () => {
  const retryable = new DeliveryProviderError("rate limited", { status: 429 });
  const permanent = new DeliveryProviderError("bad request", { status: 400 });

  it("first failure schedules the first backoff slot", () => {
    const decision = decideRetry({ error: retryable, attemptsConsumed: 1, now: NOW });
    expect(decision).toEqual({
      action: "retry",
      nextAttemptAt: new Date(NOW.getTime() + 1_000),
      delayMs: 1_000,
    });
  });

  it("second failure schedules the second backoff slot", () => {
    const decision = decideRetry({ error: retryable, attemptsConsumed: 2, now: NOW });
    expect(decision).toEqual({
      action: "retry",
      nextAttemptAt: new Date(NOW.getTime() + 2_000),
      delayMs: 2_000,
    });
  });

  it("third failure is terminal (budget consumed)", () => {
    expect(decideRetry({ error: retryable, attemptsConsumed: 3, now: NOW })).toEqual({
      action: "fail",
    });
  });

  it("permanent errors are terminal on the first failure", () => {
    expect(decideRetry({ error: permanent, attemptsConsumed: 1, now: NOW })).toEqual({
      action: "fail",
    });
  });

  it("non-provider errors are terminal", () => {
    expect(decideRetry({ error: new Error("crash"), attemptsConsumed: 1, now: NOW })).toEqual({
      action: "fail",
    });
  });

  it("a missing account retries through the full budget", () => {
    const missing = new DeliveryAccountUnavailableError();
    expect(decideRetry({ error: missing, attemptsConsumed: 1, now: NOW }).action).toBe("retry");
    expect(decideRetry({ error: missing, attemptsConsumed: 2, now: NOW }).action).toBe("retry");
    expect(decideRetry({ error: missing, attemptsConsumed: 3, now: NOW }).action).toBe("fail");
  });
});

describe("sanitizeAttemptError", () => {
  it("uses the error message but never provider internals", () => {
    expect(sanitizeAttemptError(new Error("Call failed access_token=EAAB123secret&x=1"))).toBe(
      "Call failed access_token=[redacted]&x=1",
    );
  });

  it("redacts access tokens with any casing", () => {
    expect(sanitizeAttemptError(new Error("ACCESS_TOKEN=abc123"))).toBe("access_token=[redacted]");
  });

  it("truncates long messages", () => {
    const long = `x${"y".repeat(400)}`;
    expect(sanitizeAttemptError(new Error(long))).toHaveLength(200);
  });

  it("handles non-Error throwables", () => {
    expect(sanitizeAttemptError("plain string")).toBe("plain string");
    expect(sanitizeAttemptError(null)).toContain("Unknown delivery failure");
    expect(sanitizeAttemptError(42)).toContain("Unknown delivery failure");
  });
});
