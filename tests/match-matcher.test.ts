import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_SOURCE,
  extractKeywords,
  matchProductsToContent,
  normalizeMatchText,
  type MatchableContent,
  type MatchableProduct,
} from "@/modules/campaigns/matching/matcher";
import { MATCH_RULE_WEIGHTS } from "@/modules/campaigns/matching/scorer";

/**
 * PR005.1 — Matcher Engine.
 *
 * Deterministic rules ONLY (no OpenAI, no computer vision, no embeddings,
 * no TikTok): each rule fires in isolation and in combination, and the
 * output confidence is normalized to 0.00–1.00 (never above 1).
 */

function content(overrides: Partial<MatchableContent> = {}): MatchableContent {
  return { id: "content-1", title: "review de moda", caption: null, ...overrides };
}

function product(overrides: Partial<MatchableProduct> = {}): MatchableProduct {
  return { id: "product-1", name: "Produto", slug: "produto", ...overrides };
}

describe("text normalization", () => {
  it("strips accents, case and punctuation into one canonical space", () => {
    expect(normalizeMatchText("Tênis CHUNKY — edição nº1!")).toBe("tenis chunky edicao n 1");
  });

  it("treats hyphens as spaces so slugs and titles live together", () => {
    expect(normalizeMatchText("camisa-masculina")).toBe("camisa masculina");
    expect(normalizeMatchText("Camisa Masculina")).toBe(normalizeMatchText("camisa-masculina"));
  });

  it("extracts significant keywords, dropping stopwords and number-only tokens", () => {
    expect(extractKeywords("Camisa de Verão 2024", "camisa-verao-2024")).toEqual([
      "camisa",
      "verao",
    ]);
  });
});

describe("rule: keyword in title (+40)", () => {
  it("fires when a product keyword appears as a whole word in the title", () => {
    const drafts = matchProductsToContent(
      [content({ title: "hoodie e streetwear no look", category: "reviews" })],
      [product({ name: "Hoodie Streetwear", slug: "hoodie-streetwear", category: "streetwear" })],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.confidence).toBe(0.4);
  });

  it("does NOT fire for a substring of a bigger word (that is the +15 rule)", () => {
    const drafts = matchProductsToContent(
      [content({ title: "hoodie review", category: "reviews" })],
      [product({ name: "Hood", slug: "hood-preto", category: "hoods" })],
    );
    // Only the partial-word rule fires for "hood" ↔ "hoodie".
    expect(drafts[0]?.confidence).toBe(0.15);
  });

  it("checks the TITLE only — a keyword present solely in the caption does not fire", () => {
    const drafts = matchProductsToContent(
      [content({ title: "look do dia", caption: "usando o hoodie hoje", category: "looks" })],
      [product({ name: "Hoodie", slug: "hoodie-basico", category: "streetwear" })],
    );
    expect(drafts).toHaveLength(0);
  });
});

describe("rule: category coincidence (+25)", () => {
  it("fires when explicit categories coincide", () => {
    const drafts = matchProductsToContent(
      [content({ title: "lookbook de outono", category: "streetwear" })],
      [product({ name: "Moletom Ziper", slug: "moletom-ziper", category: "streetwear" })],
    );
    expect(drafts[0]?.confidence).toBe(0.25);
  });

  it("derives the content category from the first significant title token", () => {
    // "camisa masculina — video 001" → "camisa"; slug "camisa-masculina" → "camisa".
    const drafts = matchProductsToContent(
      [content({ title: "camisa masculina — video 001" })],
      [product({ name: "Camisa Masculina", slug: "camisa-masculina" })],
    );
    expect(drafts[0]?.confidence).toBe(0.85);
  });

  it("derives the product category from the first significant slug token", () => {
    const drafts = matchProductsToContent(
      [content({ title: "jaqueta premium review", category: "jaquetas" })],
      [product({ name: "Jaqueta Premium", slug: "jaqueta-premium-impermeavel" })],
    );
    // category "jaqueta" ≠ "jaquetas" → no +25.
    expect(drafts[0]?.confidence).toBe(0.4);
  });

  it("never fires when either side has no category", () => {
    const drafts = matchProductsToContent(
      [content({ title: "001 002 003", category: null })],
      [product({ name: "Camisa", slug: "camisa", category: "camisas" })],
    );
    expect(drafts).toHaveLength(0);
  });
});

describe("rule: slug coincidence (+20)", () => {
  it("fires when the slug phrase appears in the caption", () => {
    const drafts = matchProductsToContent(
      [content({ title: "look do dia", caption: "usando a camisa azul hoje", category: "looks" })],
      [
        product({
          name: "Camisa",
          slug: "camisa-azul",
          category: "camisas",
          keywords: ["algodao"],
        }),
      ],
    );
    expect(drafts[0]?.confidence).toBe(0.2);
  });

  it("matches the slug with accents and case normalized", () => {
    const drafts = matchProductsToContent(
      [content({ title: "adorei o Tênis Chunky", category: "reviews" })],
      [
        product({
          name: "Tênis Chunky",
          slug: "tenis-chunky",
          category: "tenis",
          keywords: ["corrida"],
        }),
      ],
    );
    expect(drafts[0]?.confidence).toBe(0.2);
  });

  it("does not fire for a partial slug phrase", () => {
    const drafts = matchProductsToContent(
      [content({ title: "camisa masculina premium", category: "a" })],
      [
        product({
          name: "Camisa",
          slug: "camisa-masculina-premium-2024",
          category: "b",
          keywords: ["algodao"],
        }),
      ],
    );
    expect(drafts).toHaveLength(0);
  });
});

describe("rule: partial word (+15)", () => {
  it("fires when a keyword contains a content word (hood ↔ hoodie)", () => {
    const drafts = matchProductsToContent(
      [content({ title: "meu hoodie favorito", category: "a" })],
      [product({ name: "Hood", slug: "hood-x", category: "b" })],
    );
    expect(drafts[0]?.confidence).toBe(0.15);
  });

  it("fires when a content word contains a keyword (regatas ↔ regata)", () => {
    const drafts = matchProductsToContent(
      [content({ title: "regata fitness review", category: "a" })],
      [
        product({
          name: "Regatas Fitness",
          slug: "regatas-fitness",
          category: "b",
          keywords: ["regatas"],
        }),
      ],
    );
    expect(drafts[0]?.confidence).toBe(0.15);
  });

  it("ignores fragments shorter than 4 characters", () => {
    const drafts = matchProductsToContent(
      [content({ title: "camisa abcdef review", category: "a" })],
      [product({ name: "Abc", slug: "abc-xyz", category: "b" })],
    );
    expect(drafts).toHaveLength(0);
  });

  it("scans the caption too (partial signal comes from the full text)", () => {
    const drafts = matchProductsToContent(
      [content({ title: "look do dia", caption: "completando o moletom hoodie", category: "a" })],
      [product({ name: "Hood", slug: "hood-x", category: "b" })],
    );
    expect(drafts[0]?.confidence).toBe(0.15);
  });
});

describe("rules combined", () => {
  it("reaches full confidence (1.00) when every rule fires — never above 1", () => {
    const drafts = matchProductsToContent(
      [
        content({
          title: "camisa masculina unboxing",
          caption: "a melhor camisa masculina do ano",
          category: "camisas",
        }),
      ],
      [
        product({
          name: "Camisa Masculina Premium",
          slug: "camisa-masculina",
          category: "camisas",
          keywords: ["camisa", "masculin"],
        }),
      ],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.confidence).toBe(1);
    expect(drafts[0]?.confidence).toBeLessThanOrEqual(1);
  });

  it("accumulates the exact spec weights (40 + 25 + 20 = 0.85 for the topic match)", () => {
    const drafts = matchProductsToContent(
      [content({ title: "jaqueta premium — video 002" })],
      [product({ name: "Jaqueta Premium", slug: "jaqueta-premium" })],
    );
    expect(drafts[0]?.confidence).toBe(
      (MATCH_RULE_WEIGHTS.keywordInTitle + MATCH_RULE_WEIGHTS.category + MATCH_RULE_WEIGHTS.slug) /
        100,
    );
  });
});

describe("engine contract", () => {
  const contents: MatchableContent[] = [
    content({ id: "c1", title: "camisa masculina — video 001" }),
    content({ id: "c2", title: "tênis chunky — live 034" }),
    content({ id: "c3", title: "receita de bolo caseiro" }),
  ];
  const products: MatchableProduct[] = [
    product({ id: "p1", name: "Camisa Masculina", slug: "camisa-masculina" }),
    product({ id: "p2", name: "Tênis Chunky", slug: "tenis-chunky" }),
    product({ id: "p3", name: "Hoodie Básico", slug: "hoodie-basico" }),
  ];

  it("discards pairs with zero score", () => {
    const drafts = matchProductsToContent(contents, products);
    for (const draft of drafts) {
      expect(draft.confidence).toBeGreaterThan(0);
    }
    // c3 ("receita de bolo") matches nothing.
    expect(drafts.filter((draft) => draft.externalContentId === "c3")).toHaveLength(0);
  });

  it("produces at most one draft per (content, product) pair", () => {
    const drafts = matchProductsToContent(contents, products);
    const pairs = new Set(drafts.map((draft) => `${draft.externalContentId}:${draft.productId}`));
    expect(pairs.size).toBe(drafts.length);
  });

  it("sorts by confidence descending", () => {
    const drafts = matchProductsToContent(contents, products);
    const confidences = drafts.map((draft) => draft.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
  });

  it("stamps matchedBy = RULE by default (deterministic rules, not AI)", () => {
    expect(DEFAULT_MATCH_SOURCE).toBe("RULE");
    for (const draft of matchProductsToContent(contents, products)) {
      expect(draft.matchedBy).toBe("RULE");
    }
  });

  it("honours an explicit matchedBy override", () => {
    const drafts = matchProductsToContent(contents, products, { matchedBy: "AI" });
    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.matchedBy).toBe("AI");
    }
  });

  it("is deterministic — identical inputs produce identical outputs", () => {
    expect(matchProductsToContent(contents, products)).toEqual(
      matchProductsToContent(contents, products),
    );
  });

  it("returns drafts carrying exactly the four persistence columns", () => {
    const [draft] = matchProductsToContent(contents, products);
    expect(Object.keys(draft ?? {}).sort()).toEqual([
      "confidence",
      "externalContentId",
      "matchedBy",
      "productId",
    ]);
  });

  it("accepts plain Prisma rows (extra fields are ignored, optionals absent)", () => {
    const prismaLikeContent = {
      id: "c9",
      platform: "MOCK",
      externalId: "mock-video-009",
      type: "VIDEO",
      status: "IMPORTED",
      title: "hoodie streetwear — video 009",
      url: null,
      caption: "Conteúdo mock sobre hoodie streetwear.",
      views: 1000,
      createdAt: new Date(),
    };
    const prismaLikeProduct = {
      id: "p9",
      name: "Hoodie Streetwear",
      slug: "hoodie-streetwear",
      description: "heavyweight",
      priceCents: 24900,
      status: "ACTIVE",
    };
    const drafts = matchProductsToContent([prismaLikeContent], [prismaLikeProduct]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.externalContentId).toBe("c9");
    expect(drafts[0]?.productId).toBe("p9");
    expect(drafts[0]?.confidence).toBe(0.85);
  });

  it("returns an empty array for empty inputs", () => {
    expect(matchProductsToContent([], products)).toEqual([]);
    expect(matchProductsToContent(contents, [])).toEqual([]);
    expect(matchProductsToContent([], [])).toEqual([]);
  });

  it("explicit keywords replace the derived name+slug keywords", () => {
    const drafts = matchProductsToContent(
      [content({ title: "regata fitness review", category: "a" })],
      [
        product({
          name: "Regata Fitness",
          slug: "regata-fitness-premium",
          category: "b",
          keywords: ["algodao"],
        }),
      ],
    );
    // Derived keywords would score +40 ("regata"); the explicit override does not.
    expect(drafts).toHaveLength(0);
  });
});
