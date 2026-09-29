import { describe, expect, it } from "vitest";
import {
  baseSlug,
  resolveUniqueSlug,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
} from "@/modules/commerce/products/validators/slug";

describe("slug — baseSlug", () => {
  it("slugifies a product name", () => {
    expect(baseSlug("Moletom Premium 2.0")).toBe("moletom-premium-2-0");
  });

  it("strips accents (pt-BR)", () => {
    expect(baseSlug("Calça Jeans Não-Convencional")).toBe("calca-jeans-nao-convencional");
  });

  it("falls back when the name has no sluggable characters", () => {
    expect(baseSlug("!!! ***")).toBe("produto");
  });

  it("caps the slug length", () => {
    const slug = baseSlug("a".repeat(300));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
  });

  it("always produces a valid slug", () => {
    for (const name of ["Olá Mundo", "  spaces  ", "UPPER_case", "ção"]) {
      expect(baseSlug(name)).toMatch(SLUG_PATTERN);
    }
  });
});

describe("slug — resolveUniqueSlug", () => {
  it("returns the base slug when free", async () => {
    const slug = await resolveUniqueSlug("Moletom Premium", async () => false);
    expect(slug).toBe("moletom-premium");
  });

  it("appends -2 on first collision", async () => {
    const taken = new Set(["moletom-premium"]);
    const slug = await resolveUniqueSlug("Moletom Premium", async (c) => taken.has(c));
    expect(slug).toBe("moletom-premium-2");
  });

  it("keeps incrementing until a free candidate is found", async () => {
    const taken = new Set(["camiseta", "camiseta-2", "camiseta-3"]);
    const slug = await resolveUniqueSlug("Camiseta", async (c) => taken.has(c));
    expect(slug).toBe("camiseta-4");
  });

  it("prefers an explicit slug over the name", async () => {
    const slug = await resolveUniqueSlug("Nome Qualquer", async () => false, {
      preferred: "meu-slug-custom",
    });
    expect(slug).toBe("meu-slug-custom");
  });

  it("suffixed candidates never exceed the max length", async () => {
    const longName = "produto-".repeat(20);
    const taken = new Set([baseSlug(longName)]);
    const slug = await resolveUniqueSlug(longName, async (c) => taken.has(c));
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX_LENGTH);
    expect(slug).toMatch(/-2$/);
  });
});
