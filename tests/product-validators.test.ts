import { describe, expect, it } from "vitest";
import { ProductStatus } from "@prisma/client";
import {
  createProductSchema,
  productCostSchema,
  productListQuerySchema,
  productMediaSchema,
  productMetricSchema,
  productVariantSchema,
  updateProductSchema,
  PRODUCT_PAGE_SIZE_DEFAULT,
  PRODUCT_PAGE_SIZE_MAX,
} from "@/modules/commerce/products/validators/product.schema";

describe("validators — createProductSchema", () => {
  it("accepts a minimal valid payload with defaults", () => {
    const parsed = createProductSchema.parse({ name: "Moletom Premium" });
    expect(parsed.name).toBe("Moletom Premium");
    expect(parsed.priceCents).toBe(0);
    expect(parsed.currency).toBe("BRL");
    expect(parsed.status).toBe(ProductStatus.DRAFT);
    expect(parsed.stockQuantity).toBe(0);
    expect(parsed.slug).toBeUndefined();
  });

  it("rejects names that are too short", () => {
    expect(createProductSchema.safeParse({ name: "A" }).success).toBe(false);
  });

  it("rejects negative or fractional prices", () => {
    expect(createProductSchema.safeParse({ name: "Ok", priceCents: -1 }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "Ok", priceCents: 10.5 }).success).toBe(false);
  });

  it("rejects malformed slugs", () => {
    for (const slug of ["Com Espaço", "UPPER", "acentuação", "-lead", "trail-"]) {
      expect(createProductSchema.safeParse({ name: "Ok", slug }).success).toBe(false);
    }
  });

  it("accepts a valid explicit slug", () => {
    const parsed = createProductSchema.parse({ name: "Ok", slug: "meu-produto-2" });
    expect(parsed.slug).toBe("meu-produto-2");
  });

  it("normalizes empty strings to undefined for optional fields", () => {
    const parsed = createProductSchema.parse({
      name: "Ok",
      sku: "",
      description: "",
      imageUrl: "",
    });
    expect(parsed.sku).toBeUndefined();
    expect(parsed.description).toBeUndefined();
    expect(parsed.imageUrl).toBeUndefined();
  });

  it("uppercases the currency", () => {
    expect(createProductSchema.parse({ name: "Ok", currency: "brl" }).currency).toBe("BRL");
  });

  it("never accepts organizationId from the client", () => {
    const parsed = createProductSchema.parse({
      name: "Ok",
      organizationId: "attacker-org",
    } as never);
    expect("organizationId" in parsed).toBe(false);
  });
});

describe("validators — updateProductSchema", () => {
  it("accepts partial payloads", () => {
    expect(updateProductSchema.safeParse({ priceCents: 14990 }).success).toBe(true);
    expect(updateProductSchema.safeParse({}).success).toBe(true);
  });
});

describe("validators — productMediaSchema", () => {
  it("requires a valid URL", () => {
    expect(productMediaSchema.safeParse({ url: "not-a-url" }).success).toBe(false);
    expect(productMediaSchema.safeParse({ url: "https://cdn.brobond.ai/a.png" }).success).toBe(
      true,
    );
  });

  it("defaults to IMAGE / not primary", () => {
    const parsed = productMediaSchema.parse({ url: "https://cdn.brobond.ai/a.png" });
    expect(parsed.type).toBe("IMAGE");
    expect(parsed.isPrimary).toBe(false);
  });
});

describe("validators — productVariantSchema", () => {
  it("accepts nullish price/cost (inherit from product)", () => {
    const parsed = productVariantSchema.parse({ name: "Tamanho M" });
    expect(parsed.priceCents ?? null).toBeNull();
    expect(parsed.costCents ?? null).toBeNull();
    expect(parsed.isActive).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(productVariantSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("accepts a string attribute map", () => {
    const parsed = productVariantSchema.parse({
      name: "M / Preto",
      attributes: { size: "M", color: "preto" },
    });
    expect(parsed.attributes).toEqual({ size: "M", color: "preto" });
  });
});

describe("validators — productCostSchema", () => {
  it("requires unitCents and defaults the rest to zero", () => {
    const parsed = productCostSchema.parse({ unitCents: 2500 });
    expect(parsed.freightCents).toBe(0);
    expect(parsed.packagingCents).toBe(0);
    expect(parsed.feesCents).toBe(0);
    expect(parsed.otherCents).toBe(0);
    expect(parsed.currency).toBe("BRL");
  });

  it("rejects negative components", () => {
    expect(productCostSchema.safeParse({ unitCents: 100, freightCents: -1 }).success).toBe(false);
  });
});

describe("validators — productMetricSchema", () => {
  it("coerces the date and defaults counters to zero", () => {
    const parsed = productMetricSchema.parse({ date: "2026-09-22" });
    expect(parsed.date).toBeInstanceOf(Date);
    expect(parsed.views).toBe(0);
    expect(parsed.revenueCents).toBe(0);
  });

  it("rejects negative counters", () => {
    expect(productMetricSchema.safeParse({ date: "2026-09-22", views: -1 }).success).toBe(false);
  });
});

describe("validators — productListQuerySchema (dashboard URL state)", () => {
  it("provides sane defaults for an empty query", () => {
    const parsed = productListQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(PRODUCT_PAGE_SIZE_DEFAULT);
    expect(parsed.sort).toBe("createdAt");
    expect(parsed.order).toBe("desc");
  });

  it("coerces string search params", () => {
    const parsed = productListQuerySchema.parse({
      page: "3",
      pageSize: "25",
      minMarginBps: "3000",
      maxPriceCents: "10000",
      inStock: "true",
      status: "ACTIVE",
      sort: "marginBps",
      order: "asc",
    });
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(25);
    expect(parsed.minMarginBps).toBe(3000);
    expect(parsed.maxPriceCents).toBe(10000);
    expect(parsed.inStock).toBe(true);
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.sort).toBe("marginBps");
    expect(parsed.order).toBe("asc");
  });

  it("falls back gracefully on malformed params instead of throwing", () => {
    const parsed = productListQuerySchema.parse({
      page: "abc",
      pageSize: "-5",
      status: "INVALID",
      sort: "passwordHash", // hostile sort field
      order: "sideways",
    });
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(PRODUCT_PAGE_SIZE_DEFAULT);
    expect(parsed.status).toBeUndefined();
    expect(parsed.sort).toBe("createdAt");
    expect(parsed.order).toBe("desc");
  });

  it("caps the page size", () => {
    const parsed = productListQuerySchema.parse({ pageSize: "9999" });
    expect(parsed.pageSize).toBeLessThanOrEqual(PRODUCT_PAGE_SIZE_MAX);
  });
});
