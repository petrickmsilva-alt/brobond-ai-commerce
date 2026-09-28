import { describe, expect, it, vi } from "vitest";
import { log, sanitizeLogData } from "@/lib/observability/logger";

describe("observability logger", () => {
  it("recursively redacts credential-like keys, connection strings and obvious PII", () => {
    const value = sanitizeLogData({
      authorization: "Bearer secret",
      nested: {
        DATABASE_URL: "postgresql://user:password@db.example/brobond",
        email: "person@example.com",
        value: "postgresql://user:password@db.example/brobond",
      },
      safe: "ready",
    });

    expect(value).toEqual({
      authorization: "[REDACTED]",
      nested: {
        DATABASE_URL: "[REDACTED]",
        email: "[REDACTED]",
        value: "[REDACTED]",
      },
      safe: "ready",
    });
  });

  it("emits JSON with request and correlation identifiers", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    log({
      event: "REQUEST_COMPLETED",
      level: "info",
      requestId: "request-1",
      correlationId: "correlation-1",
      context: { token: "should-not-appear" },
    });

    expect(JSON.parse(info.mock.calls[0]?.[0] ?? "{}")).toMatchObject({
      event: "REQUEST_COMPLETED",
      level: "info",
      requestId: "request-1",
      correlationId: "correlation-1",
      context: { token: "[REDACTED]" },
    });
    info.mockRestore();
  });
});
