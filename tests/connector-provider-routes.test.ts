import { describe, expect, it } from "vitest";
import {
  CONNECTOR_PROVIDER_SLUGS,
  CONNECTOR_PROVIDERS,
  connectorProviderFromSlug,
  connectorProviderPath,
} from "@/modules/marketplace/core/providers";

/**
 * PR014 — isolated connector routes.
 *
 * The slug registry is the single source of truth shared by the dynamic
 * route (`app/dashboard/connectors/[provider]`), the sidebar links and the
 * OAuth callbacks. These tests pin the bijection provider ⇄ slug so no
 * screen can ever 404 (or, worse, resolve the WRONG platform).
 */

describe("connector provider slug registry", () => {
  it("gives every provider a unique, kebab-case slug", () => {
    const slugs = Object.values(CONNECTOR_PROVIDER_SLUGS);
    expect(new Set(slugs).size).toBe(CONNECTOR_PROVIDERS.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("resolves every slug back to its provider (bijection)", () => {
    for (const provider of CONNECTOR_PROVIDERS) {
      expect(connectorProviderFromSlug(CONNECTOR_PROVIDER_SLUGS[provider])).toBe(provider);
    }
  });

  it("returns null for unknown slugs — the route renders 404", () => {
    expect(connectorProviderFromSlug("amazon")).toBeNull();
    expect(connectorProviderFromSlug("")).toBeNull();
    expect(connectorProviderFromSlug("MERCADO-LIVRE")).toBeNull();
  });

  it("builds the isolated detail path of each provider", () => {
    expect(connectorProviderPath("MERCADOLIVRE")).toBe("/dashboard/connectors/mercado-livre");
    expect(connectorProviderPath("MERCADOPAGO")).toBe("/dashboard/connectors/mercado-pago");
    expect(connectorProviderPath("SHOPEE")).toBe("/dashboard/connectors/shopee");
    expect(connectorProviderPath("NUVEMSHOP")).toBe("/dashboard/connectors/nuvemshop");
    expect(connectorProviderPath("TIKTOK")).toBe("/dashboard/connectors/tiktok");
    expect(connectorProviderPath("INSTAGRAM")).toBe("/dashboard/connectors/instagram");
  });
});
