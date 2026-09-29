export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const [{ registerOpenTelemetry }, sentry] = await Promise.all([
      import("@/lib/observability/otel"),
      process.env.SENTRY_DSN ? import("./sentry.server.config") : Promise.resolve(undefined),
    ]);

    registerOpenTelemetry();
    void sentry;
  }

  if (process.env.NEXT_RUNTIME === "edge" && process.env.SENTRY_DSN) {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = process.env.SENTRY_DSN
  ? async (...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) => {
      const Sentry = await import("@sentry/nextjs");
      Sentry.captureRequestError(...args);
    }
  : undefined;
