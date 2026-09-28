import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY =
  /(authorization|cookie|token|password|secret|api[_-]?key|database[_-]?url|private[_-]?key|credential|dsn)/i;
const PII_KEY =
  /(^|[_-])(email|e-mail|phone|mobile|address|first[_-]?name|last[_-]?name|full[_-]?name|cpf|document)([_-]|$)/i;
const CONNECTION_STRING = /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/i;
const BEARER_TOKEN = /\b(?:bearer|basic)\s+[a-z0-9._~+/=-]+/i;
const JWT = /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/;
const MAX_DEPTH = 8;

export interface LogEntry {
  event: string;
  level: LogLevel;
  requestId?: string;
  correlationId?: string;
  context?: object;
}

/**
 * Redacts credentials and obvious PII before data can reach any log sink.
 * It is exported so error reporting and tests share the exact same boundary.
 */
export function sanitizeLogData(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
    };
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogData(item, depth + 1, seen));
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_KEY.test(key) || PII_KEY.test(key)
        ? REDACTED
        : sanitizeLogData(nestedValue, depth + 1, seen),
    ]),
  );
}

export function log(entry: LogEntry): void {
  const payload = {
    timestamp: new Date().toISOString(),
    event: entry.event,
    level: entry.level,
    ...(entry.requestId ? { requestId: entry.requestId } : {}),
    ...(entry.correlationId ? { correlationId: entry.correlationId } : {}),
    ...(entry.context ? { context: sanitizeLogData(entry.context) } : {}),
  };

  const serialized = JSON.stringify(payload);
  switch (entry.level) {
    case "debug":
      console.debug(serialized);
      break;
    case "warn":
      console.warn(serialized);
      break;
    case "error":
      console.error(serialized);
      break;
    default:
      console.info(serialized);
  }
}

function sanitizeString(value: string): string {
  return CONNECTION_STRING.test(value) || BEARER_TOKEN.test(value) || JWT.test(value)
    ? REDACTED
    : value;
}
