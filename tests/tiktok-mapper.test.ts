import { describe, expect, it } from "vitest";
import {
  decimalToCents,
  mapTikTokCreator,
  mapTikTokProduct,
  mapTikTokProductExternalContent,
} from "@/modules/connectors/tiktok/sync/mapper";

describe("TikTok Shop mappers", () => {
  it("maps products into stable internal Product identity and minor-unit prices", () => {
    const product = mapTikTokProduct({
      product_id: "P-123",
      title: "Camiseta oficial",
      description: "Algodão",
      status: "ACTIVATED",
      images: [{ urls: ["https://cdn.example.test/product.jpg"] }],
      skus: [{ price: { price: "19.99", currency: "BRL" }, stock_info: { available_stock: 4 } }],
    });
    expect(product).toMatchObject({
      tiktokProductId: "P-123",
      slug: "tiktok-p-123",
      priceCents: 1999,
      currency: "BRL",
      stockQuantity: 4,
      status: "ACTIVE",
    });
  });

  it("preserves explicitly minor-unit official amount fields", () => {
    expect(
      mapTikTokProduct({
        product_id: "P-2",
        skus: [{ price: { amount: 1299, currency: "USD" } }],
      }).priceCents,
    ).toBe(1299);
  });

  it("maps a product to deduplicable TIKTOK ExternalContent", () => {
    const content = mapTikTokProductExternalContent(
      { product_id: "P-3", title: "Produto" },
      "shop-1",
    );
    expect(content).toMatchObject({
      platform: "TIKTOK",
      externalId: "product:shop-1:P-3",
      type: "PRODUCT",
      status: "IMPORTED",
    });
    expect(content.raw).not.toHaveProperty("access_token");
  });

  it("maps creators to a stable source identity and bounded score", () => {
    const creator = mapTikTokCreator({
      creator_id: "creator-1",
      username: "@ana",
      nickname: "Ana",
      follower_count: 100_000,
      average_video_views: 10_000,
      engagement_rate: 4.2,
    });
    expect(creator).toMatchObject({ externalId: "creator-1", handle: "ana", displayName: "Ana" });
    expect(creator.creatorScore).toBeGreaterThan(0);
    expect(creator.creatorScore).toBeLessThanOrEqual(100);
  });

  it("does not use floating point for decimal cents", () => {
    expect(decimalToCents("0.29")).toBe(29);
    expect(decimalToCents("12,50")).toBe(1250);
    expect(decimalToCents("invalid")).toBe(0);
  });
});
