import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { buildListWhere } from "@/modules/commerce/products/repositories/product-list-where";
import { productListQuerySchema } from "@/modules/commerce/products/validators/product.schema";

const ORG = "org_test_1";

function query(input: Record<string, string> = {}) {
  return productListQuerySchema.parse(input);
}

describe("buildListWhere — tenant isolation", () => {
  it("always injects organizationId, even for an empty query", () => {
    const where = buildListWhere(ORG, query());
    expect(where.organizationId).toBe(ORG);
  });

  it("throws without an organization scope", () => {
    expect(() => buildListWhere("", query())).toThrow(AuthorizationError);
    expect(() => buildListWhere(undefined as never, query())).toThrow(AuthorizationError);
  });

  it("keeps the tenant scope when every filter is active", () => {
    const where = buildListWhere(
      ORG,
      query({
        search: "hoodie",
        status: "ACTIVE",
        minMarginBps: "2000",
        maxMarginBps: "8000",
        minPriceCents: "1000",
        maxPriceCents: "50000",
        inStock: "true",
      }),
    );
    expect(where.organizationId).toBe(ORG);
  });
});

describe("buildListWhere — filters", () => {
  it("builds an OR search over name, slug and sku", () => {
    const where = buildListWhere(ORG, query({ search: "hoodie" }));
    expect(where.OR).toEqual([
      { name: { contains: "hoodie", mode: "insensitive" } },
      { slug: { contains: "hoodie", mode: "insensitive" } },
      { sku: { contains: "hoodie", mode: "insensitive" } },
    ]);
  });

  it("filters by status", () => {
    expect(buildListWhere(ORG, query({ status: "ARCHIVED" })).status).toBe("ARCHIVED");
    expect(buildListWhere(ORG, query()).status).toBeUndefined();
  });

  it("builds margin range filters (bps)", () => {
    const where = buildListWhere(ORG, query({ minMarginBps: "3000", maxMarginBps: "7000" }));
    expect(where.marginBps).toEqual({ gte: 3000, lte: 7000 });
  });

  it("builds price range filters (cents)", () => {
    const where = buildListWhere(ORG, query({ minPriceCents: "1000" }));
    expect(where.priceCents).toEqual({ gte: 1000 });
  });

  it("maps inStock to stock comparisons", () => {
    expect(buildListWhere(ORG, query({ inStock: "true" })).stockQuantity).toEqual({ gt: 0 });
    expect(buildListWhere(ORG, query({ inStock: "false" })).stockQuantity).toEqual({ lte: 0 });
    expect(buildListWhere(ORG, query()).stockQuantity).toBeUndefined();
  });
});
