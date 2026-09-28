import { afterEach, describe, expect, it, vi } from "vitest";

const captureException = vi.hoisted(() => vi.fn());
const setTag = vi.hoisted(() => vi.fn());
const setContext = vi.hoisted(() => vi.fn());

vi.mock("@sentry/nextjs", () => ({
  captureException,
  withScope: (
    callback: (scope: { setTag: typeof setTag; setContext: typeof setContext }) => void,
  ) => callback({ setTag, setContext }),
}));

const { reportError } = await import("@/lib/observability/error-reporter");

afterEach(() => {
  delete process.env.SENTRY_DSN;
  captureException.mockReset();
  setTag.mockReset();
  setContext.mockReset();
});

describe("reportError()", () => {
  it("logs safely without initializing a Sentry event when no DSN is configured", () => {
    const result = reportError(new Error("postgresql://user:password@db.internal/brobond"), {
      requestId: "request-123",
      authorization: "Bearer hidden",
    });

    expect(result).toEqual({ requestId: "request-123" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("forwards only sanitized context to Sentry when configured", () => {
    process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/123";

    reportError(new Error("failure"), {
      requestId: "request-123",
      correlationId: "correlation-123",
      token: "hidden",
    });

    expect(captureException).toHaveBeenCalledOnce();
    expect(setTag).toHaveBeenCalledWith("request_id", "request-123");
    expect(setTag).toHaveBeenCalledWith("correlation_id", "correlation-123");
    expect(setContext).toHaveBeenCalledWith(
      "operational",
      expect.objectContaining({ token: "[REDACTED]" }),
    );
  });
});
