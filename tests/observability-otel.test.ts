import { describe, expect, it } from "vitest";
import { getOpenTelemetryConfig } from "@/lib/observability/otel";

describe("OpenTelemetry configuration", () => {
  it("does not enable a telemetry configuration without an OTLP endpoint", () => {
    expect(getOpenTelemetryConfig({})).toBeNull();
  });

  it("uses configured values and safe service defaults", () => {
    expect(
      getOpenTelemetryConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/v1/traces",
      }),
    ).toEqual({
      endpoint: "https://otel.example/v1/traces",
      serviceName: "brobond-ai-commerce",
      serviceVersion: "unknown",
    });
  });
});
