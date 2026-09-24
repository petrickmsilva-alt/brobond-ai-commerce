import "server-only";

import { DeliveryProviderError } from "../core/delivery.interface";

/**
 * Delivery retry engine (PR010 §7) — PURE, deterministic, testable.
 *
 * Contract:
 *   - MAX_ATTEMPTS = 3 provider-send attempts per message.
 *   - Exponential backoff: attempt N (1-based, already consumed) waits
 *     BASE * 2^(N-1) milliseconds, capped at MAX_DELAY.
 *       after 1 failed attempt → wait 1s
 *       after 2 failed attempts → wait 2s
 *       after 3 failed attempts → exhausted (FAILED, terminal)
 *   - Only retryable failures consume the schedule: network errors and
 *     provider 408/429/5xx. 4xx validation/auth errors fail immediately.
 */

export const DELIVERY_MAX_ATTEMPTS = 3;
export const DELIVERY_RETRY_BASE_MS = 1_000;
export const DELIVERY_RETRY_MAX_DELAY_MS = 60_000;

/** Milliseconds to wait after `attemptsConsumed` failures, before the next try. */
export function computeRetryDelayMs(attemptsConsumed: number): number {
  if (!Number.isInteger(attemptsConsumed) || attemptsConsumed < 1) {
    return DELIVERY_RETRY_BASE_MS;
  }
  const delay = DELIVERY_RETRY_BASE_MS * 2 ** (attemptsConsumed - 1);
  return Math.min(DELIVERY_RETRY_MAX_DELAY_MS, delay);
}

/** Absolute retry deadline, or `null` when the attempt budget is exhausted. */
export function computeNextAttemptAt(now: Date, attemptsConsumed: number): Date | null {
  if (isRetryExhausted(attemptsConsumed)) return null;
  return new Date(now.getTime() + computeRetryDelayMs(attemptsConsumed));
}

/** Whether the attempts budget (3) is fully consumed. */
export function isRetryExhausted(attemptsConsumed: number): boolean {
  return attemptsConsumed >= DELIVERY_MAX_ATTEMPTS;
}

/**
 * Whether a failed send may be retried at all, independent of budget.
 * `DeliveryProviderError.retryable` encodes the provider semantics; every
 * other error is treated as permanent (programming/config error — retrying
 * would only amplify it).
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof DeliveryProviderError) return error.retryable;
  return false;
}

/** The outcome of a failed attempt, decided by the retry engine. */
export type RetryDecision =
  { action: "retry"; nextAttemptAt: Date; delayMs: number } | { action: "fail" };

/** Decide what happens to a message after a failed send attempt. */
export function decideRetry(input: {
  error: unknown;
  attemptsConsumed: number;
  now: Date;
}): RetryDecision {
  if (!isRetryableError(input.error)) return { action: "fail" };
  const nextAttemptAt = computeNextAttemptAt(input.now, input.attemptsConsumed);
  if (!nextAttemptAt) return { action: "fail" };
  return {
    action: "retry",
    nextAttemptAt,
    delayMs: nextAttemptAt.getTime() - input.now.getTime(),
  };
}

/** Short, dashboard-safe error line (no provider internals, no tokens). */
export function sanitizeAttemptError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "Unknown delivery failure — see server logs.";
  return raw.replace(/access_token=[^&\s]+/gi, "access_token=[redacted]").slice(0, 200);
}
