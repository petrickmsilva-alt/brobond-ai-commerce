import { describe, expect, it } from "vitest";
import {
  KEYWORD_SLUG_FALLBACK,
  KEYWORD_SLUG_MAX_LENGTH,
  TREND_CATEGORIES,
  TREND_PAGE_SIZE_DEFAULT,
  TREND_PAGE_SIZE_MAX,
  createTrendSchema,
  keywordSlug,
  normalizeKeyword,
  trendListQuerySchema,
  trendSignalSchema,
} from "@/modules/trends/validators/trend.validator";

/**
 * PR002 — Trend validators & keyword slug helpers.
 *
 * `organizationId` is never part of any schema: the tenant always comes
 * from the session. Hostile inputs (unknown sort fields, invalid
 * categories, injected tenant ids) must fall back or be stripped.
 */

const VALID_SIGNAL = {
  keyword: "camisa masculina",
  category: "Moda",
  views: 1000,
  likes: 100,
  shares: 10,
  margin: 55,
  saturation: 20,
};

describe("TREND_CATEGORIES", () => {
  it("is exactly the PR002 category list", () => {
    expect(TREND_CATEGORIES).toEqual(["Moda", "Casual", "Street", "Executivo", "Fitness"]);
  });
});

describe("trendSignalSchema", () => {
  it("accepts a valid signal", () => {
    expect(trendSignalSchema.parse(VALID_SIGNAL)).toEqual(VALID_SIGNAL);
  });

  it("applies zero defaults for omitted metrics", () => {
    const parsed = trendSignalSchema.parse({ keyword: "polo slim", category: "Casual" });
    expect(parsed.views).toBe(0);
    expect(parsed.likes).toBe(0);
    expect(parsed.shares).toBe(0);
    expect(parsed.margin).toBe(0);
    expect(parsed.saturation).toBe(0);
  });

  it("rejects an unknown category", () => {
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, category: "Pet" })).toThrowError(
      /Categoria inválida/,
    );
  });

  it("rejects margin/saturation outside 0–100", () => {
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, margin: 101 })).toThrow();
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, saturation: -1 })).toThrow();
  });

  it("rejects negative or fractional engagement counts", () => {
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, views: -5 })).toThrow();
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, likes: 1.5 })).toThrow();
  });

  it("rejects keywords that are too short or too long", () => {
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, keyword: "a" })).toThrow();
    expect(() => trendSignalSchema.parse({ ...VALID_SIGNAL, keyword: "x".repeat(121) })).toThrow();
  });

  it("strips unknown keys — a client-supplied organizationId never survives", () => {
    const parsed = trendSignalSchema.parse({
      ...VALID_SIGNAL,
      organizationId: "org_attacker",
      isAdmin: true,
    }) as Record<string, unknown>;
    expect(parsed.organizationId).toBeUndefined();
    expect(parsed.isAdmin).toBeUndefined();
  });
});

describe("createTrendSchema", () => {
  it("accepts a valid persistence payload", () => {
    const parsed = createTrendSchema.parse({ ...VALID_SIGNAL, trendScore: 82 });
    expect(parsed.trendScore).toBe(82);
  });

  it("defaults the score to 0 when omitted", () => {
    const parsed = createTrendSchema.parse({
      keyword: "bermuda cargo",
      category: "Casual",
    });
    expect(parsed.trendScore).toBe(0);
    expect(parsed.views).toBe(0);
  });

  it("rejects a score outside 0–100", () => {
    expect(() => createTrendSchema.parse({ ...VALID_SIGNAL, trendScore: 101 })).toThrow();
    expect(() => createTrendSchema.parse({ ...VALID_SIGNAL, trendScore: -1 })).toThrow();
  });

  it("rejects a non-integer score", () => {
    expect(() => createTrendSchema.parse({ ...VALID_SIGNAL, trendScore: 82.5 })).toThrow();
  });
});

describe("trendListQuerySchema (dashboard URL state)", () => {
  it("has safe defaults (page 1 · top score first)", () => {
    const query = trendListQuerySchema.parse({});
    expect(query).toEqual({
      page: 1,
      pageSize: TREND_PAGE_SIZE_DEFAULT,
      search: undefined,
      category: undefined,
      source: undefined, // PR002.1 — no source = all sources ("Todos")
      sort: "trendScore",
      order: "desc",
    });
  });

  it("coerces numeric strings coming from the URL", () => {
    const query = trendListQuerySchema.parse({ page: "2", pageSize: "25" });
    expect(query.page).toBe(2);
    expect(query.pageSize).toBe(25);
  });

  it("falls back to page 1 on invalid input", () => {
    expect(trendListQuerySchema.parse({ page: "abc" }).page).toBe(1);
    expect(trendListQuerySchema.parse({ page: "-3" }).page).toBe(1);
  });

  it("caps the page size at the maximum", () => {
    expect(trendListQuerySchema.parse({ pageSize: "999" }).pageSize).toBe(TREND_PAGE_SIZE_DEFAULT);
    expect(trendListQuerySchema.parse({ pageSize: String(TREND_PAGE_SIZE_MAX) }).pageSize).toBe(
      TREND_PAGE_SIZE_MAX,
    );
  });

  it("falls back to the default sort on a hostile sort field", () => {
    const query = trendListQuerySchema.parse({ sort: "organizationId" });
    expect(query.sort).toBe("trendScore");
  });

  it("falls back to desc on an invalid order", () => {
    expect(trendListQuerySchema.parse({ order: "sideways" }).order).toBe("desc");
  });

  it("drops an unknown category instead of failing the page", () => {
    expect(trendListQuerySchema.parse({ category: "Tudo" }).category).toBeUndefined();
    expect(trendListQuerySchema.parse({ category: "Moda" }).category).toBe("Moda");
  });

  it("trims the free-text search", () => {
    expect(trendListQuerySchema.parse({ search: "  camisa  " }).search).toBe("camisa");
  });
});

describe("normalizeKeyword", () => {
  it("trims, collapses inner whitespace and lowercases", () => {
    expect(normalizeKeyword("  Camisa   Masculina ")).toBe("camisa masculina");
  });

  it("keeps pt-BR accents (they are part of the keyword)", () => {
    expect(normalizeKeyword("Camiseta Básica")).toBe("camiseta básica");
  });

  it("returns the empty string for whitespace-only input (schema rejects it later)", () => {
    expect(normalizeKeyword("   ")).toBe("");
  });
});

describe("keywordSlug (slug de keyword)", () => {
  it("derives a kebab-case slug from a keyword", () => {
    expect(keywordSlug("camisa masculina")).toBe("camisa-masculina");
  });

  it("normalizes casing and multiple spaces", () => {
    expect(keywordSlug("Polo   SLIM")).toBe("polo-slim");
  });

  it("strips pt-BR accents", () => {
    expect(keywordSlug("Camiseta Básica")).toBe("camiseta-basica");
    expect(keywordSlug("Tênis de Corrida")).toBe("tenis-de-corrida");
    expect(keywordSlug("Calça Jogger")).toBe("calca-jogger");
  });

  it("removes characters that are not slug-safe", () => {
    expect(keywordSlug("Hoodie Oversized!")).toBe("hoodie-oversized");
    expect(keywordSlug("boné/aba reta")).toBe("bone-aba-reta");
  });

  it("falls back to the canonical placeholder when nothing is sluggable", () => {
    expect(keywordSlug("")).toBe(KEYWORD_SLUG_FALLBACK);
    expect(keywordSlug("   ")).toBe(KEYWORD_SLUG_FALLBACK);
    expect(keywordSlug("🚀🔥")).toBe(KEYWORD_SLUG_FALLBACK);
  });

  it("caps the slug length at KEYWORD_SLUG_MAX_LENGTH", () => {
    const longKeyword = "camisa ".repeat(40).trim();
    expect(keywordSlug(longKeyword).length).toBeLessThanOrEqual(KEYWORD_SLUG_MAX_LENGTH);
  });

  it("never ends with a dangling hyphen", () => {
    expect(keywordSlug("camisa masculina-")).toBe("camisa-masculina");
  });

  it("is idempotent (slug of a slug is the slug)", () => {
    const once = keywordSlug("Camisa Masculina");
    expect(keywordSlug(once)).toBe(once);
  });
});
