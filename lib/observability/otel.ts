import "server-only";

import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { log } from "@/lib/observability/logger";

declare global {
  var __brobondOtelSdk: NodeSDK | undefined;
}

export interface OpenTelemetryConfig {
  endpoint: string;
  serviceName: string;
  serviceVersion: string;
}

export function getOpenTelemetryConfig(
  source: Record<string, string | undefined> = process.env,
): OpenTelemetryConfig | null {
  const endpoint = source.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;

  return {
    endpoint,
    serviceName: source.OTEL_SERVICE_NAME?.trim() || "brobond-ai-commerce",
    serviceVersion: source.OTEL_SERVICE_VERSION?.trim() || "unknown",
  };
}

/** Starts OTLP only when an operator has configured an endpoint. */
export function registerOpenTelemetry(
  source: Record<string, string | undefined> = process.env,
): boolean {
  const config = getOpenTelemetryConfig(source);
  if (!config || globalThis.__brobondOtelSdk) return false;

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({ url: config.endpoint }),
  });

  sdk.start();
  globalThis.__brobondOtelSdk = sdk;
  log({
    event: "OTEL_ENABLED",
    level: "info",
    context: { serviceName: config.serviceName, serviceVersion: config.serviceVersion },
  });
  return true;
}
