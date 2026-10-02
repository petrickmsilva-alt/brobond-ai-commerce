import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  buildNuvemshopAuthorizationUrl,
  exchangeNuvemshopCode,
  fetchNuvemshopProducts,
  getNuvemshopConfig,
  nuvemshopOrderStatusToSaleStatus,
  verifyNuvemshopWebhookSignature,
} from "@/modules/connectors/nuvemshop/nuvemshop.service";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.NUVEMSHOP_CLIENT_ID = "app-123";
  process.env.NUVEMSHOP_CLIENT_SECRET = "secret-456";
  process.env.NUVEMSHOP_REDIRECT_URI = "https://app.example.com/api/connectors/nuvemshop/callback";
  process.env.NUVEMSHOP_USER_AGENT = "Brobond Wear (app-123)";
  delete process.env.NUVEMSHOP_WEBHOOK_URL;
  delete process.env.NUVEMSHOP_AUTH_BASE_URL;
  delete process.env.NUVEMSHOP_API_BASE_URL;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Nuvemshop OAuth production configuration", () => {
  it("requires the static NUVEMSHOP_REDIRECT_URI", () => {
    delete process.env.NUVEMSHOP_REDIRECT_URI;
    expect(() => getNuvemshopConfig()).toThrow("NUVEMSHOP_REDIRECT_URI");
  });

  it("builds the official authorization URL with state and the static callback", () => {
    const url = new URL(buildNuvemshopAuthorizationUrl("state-1234567890123456"));
    expect(url.origin).toBe("https://www.tiendanube.com");
    expect(url.pathname).toBe("/apps/app-123/authorize");
    expect(url.searchParams.get("state")).toBe("state-1234567890123456");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/connectors/nuvemshop/callback",
    );
  });

  it("replays NUVEMSHOP_REDIRECT_URI in the authorization-code exchange", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "long-lived-token",
          token_type: "bearer",
          scope: "read_products,read_orders",
          user_id: 789,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(exchangeNuvemshopCode("oauth-code")).resolves.toEqual({
      accessToken: "long-lived-token",
      storeId: "789",
      scope: "read_products,read_orders",
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      client_id: "app-123",
      grant_type: "authorization_code",
      code: "oauth-code",
      redirect_uri: "https://app.example.com/api/connectors/nuvemshop/callback",
    });
  });
});

describe("Nuvemshop official API catalog", () => {
  it("normalizes the live product feed without a simplified fallback", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 42,
            name: { pt: "Camiseta Premium" },
            description: { pt: "Algodão certificado" },
            canonical_url: "https://loja.example.com/produtos/camiseta-premium",
            published: true,
            created_at: "2026-10-01T10:00:00.000Z",
            images: [{ src: "https://cdn.example.com/42.jpg" }],
            variants: [
              { id: 1, sku: "CAM-P", price: "129.90", stock: 3 },
              { id: 2, sku: "CAM-M", price: "129.90", stock: 2 },
            ],
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const products = await fetchNuvemshopProducts("token", "789", 50);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      externalId: "789:42",
      type: "PRODUCT",
      title: "Camiseta Premium",
      thumbnailUrl: "https://cdn.example.com/42.jpg",
      raw: { itemId: "42", storeId: "789", priceCents: 12_990, stockQuantity: 5 },
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/2025-03/789/products?");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    expect(new Headers(init?.headers).get("user-agent")).toBe("Brobond Wear (app-123)");
  });
});

describe("Nuvemshop webhooks and Sale lifecycle", () => {
  it("verifies x-linkedstore-hmac-sha256 over the exact raw body", () => {
    const rawBody = JSON.stringify({ store_id: 789, event: "order/created", id: 123 });
    const signature = createHmac("sha256", "secret-456").update(rawBody).digest("base64");
    expect(verifyNuvemshopWebhookSignature(rawBody, signature)).toBe(true);
    expect(verifyNuvemshopWebhookSignature(`${rawBody} `, signature)).toBe(false);
  });

  it("maps authoritative order states to Sale statuses", () => {
    expect(nuvemshopOrderStatusToSaleStatus("paid", "open")).toBe("PAID");
    expect(nuvemshopOrderStatusToSaleStatus("refunded", "closed")).toBe("REFUNDED");
    expect(nuvemshopOrderStatusToSaleStatus("pending", "cancelled")).toBe("CANCELLED");
    expect(nuvemshopOrderStatusToSaleStatus("pending", "open")).toBe("PENDING");
  });
});
