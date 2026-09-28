import "server-only";

import * as Sentry from "@sentry/nextjs";
import { log, sanitizeLogData, type LogContext } from "@/lib/observability/logger";

export interface ErrorReportContext extends LogContext {
  requestId?: string;
  correlationId?: string;
}

export interface ErrorReport {
  requestId: string;
}

export function reportError(error: unknown, context: ErrorReportContext = {}): ErrorReport {
  const requestId = context.requestId ?? crypto.randomUUID();
  const sanitizedContext = sanitizeLogData(context) as Record<string, unknown>;
  const safeError = toSafeError(error);

  log({
    event: "ERROR_REPORTED",
    level: "error",
    requestId,
    correlationId: context.correlationId,
    context: { ...sanitizedContext, error: safeError },
  });

  if (process.env.SENTRY_DSN) {
    Sentry.withScope((scope) => {
      scope.setTag("request_id", requestId);
      if (context.correlationId) scope.setTag("correlation_id", context.correlationId);
      scope.setContext("operational", sanitizedContext);
      Sentry.captureException(safeError);
    });
  }

  return { requestId };
}

function toSafeError(error: unknown): Error {
  if (error instanceof Error) {
    const sanitized = sanitizeLogData(error) as { message?: unknown };
    return new Error(typeof sanitized.message === "string" ? sanitized.message : "Unknown error");
  }

  const sanitized = sanitizeLogData(error);
  return new Error(typeof sanitized === "string" ? sanitized : "Unknown error");
}
