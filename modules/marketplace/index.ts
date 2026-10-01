/**
 * Marketplace module public surface (PR012 — Real Marketplace Integrations).
 *
 * Server-only services are exported for route handlers and server actions;
 * the client-safe registry (`providers.ts`) and the DTOs may be imported by
 * Client Components.
 */

export * from "./core/providers";
export * from "./core/connector.dto";
export * from "./core/errors";
