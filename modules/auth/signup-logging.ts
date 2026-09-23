import "server-only";

/**
 * Structured, correlation-friendly logs for the public signup flow.
 *
 * The signup action and provisioning service deliberately share this tiny
 * module instead of logging ad-hoc strings. It gives operators one request id
 * to follow through the healthcheck, transaction and automatic login without
 * ever putting a password (or a full email address) in the logs.
 */
export type SignupLogEvent =
  | "SIGNUP_START"
  | "ORG_CREATED"
  | "USER_CREATED"
  | "WORKSPACE_CREATED"
  | "SETTINGS_CREATED"
  | "LOGIN_SUCCESS"
  | "SIGNUP_FAILED";

export interface SignupLogFields {
  requestId: string;
  organizationId?: string;
  userId?: string;
  code?: string;
  stage?: string;
  /** Short, non-secret diagnostic suitable for an operator log. */
  reason?: string;
  /** Original stack trace for an actionable incident log. */
  stack?: string;
}

/** Writes JSON so production log aggregators can filter by `event` or request id. */
export function logSignupEvent(event: SignupLogEvent, fields: SignupLogFields): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      domain: "signup",
      event,
      ...fields,
    }),
  );
}

/**
 * Log both a structured event and the original error object. The second write
 * intentionally preserves the native stack trace in runtimes that render
 * `Error` objects specially (Next.js/Node included).
 */
export function logSignupFailure(error: unknown, fields: Omit<SignupLogFields, "stack">): void {
  const wrapper = asError(error);
  const cause = (wrapper as Error & { cause?: unknown }).cause;
  // Readiness errors wrap a driver/query failure. Keep that inner stack in
  // the structured event because it is the original operational trace.
  const original = cause instanceof Error ? cause : wrapper;

  logSignupEvent("SIGNUP_FAILED", {
    ...fields,
    reason: original.message || fields.reason || "Erro sem mensagem.",
    stack: original.stack,
  });
  console.error(error);
}

/** Converts thrown non-Error values into a useful diagnostic shape. */
export function asError(error: unknown): Error {
  if (error instanceof Error) return error;

  const message =
    typeof error === "string"
      ? error
      : (() => {
          try {
            return JSON.stringify(error);
          } catch {
            return String(error);
          }
        })();

  return new Error(message || "Erro sem mensagem.");
}
