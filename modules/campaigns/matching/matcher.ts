/**
 * Product Match Engine — deterministic rules matcher (PR005.1).
 *
 * Mission: answer "este vídeo vende este produto?" by relating imported
 * external content (videos/posts) to internal products.
 *
 * HARD SCOPE — deterministic rules ONLY:
 *   ✗ NO OpenAI (or any AI provider)
 *   ✗ NO computer vision (no frame analysis, no image understanding)
 *   ✗ NO embeddings (no vector similarity)
 *   ✗ NO TikTok integration (contents arrive already imported via PR005)
 * Every correspondence is decided by four deterministic text rules.
 *
 * RULES (weights defined in `./scorer.ts`):
 *   +40  a product keyword appears in the content TITLE
 *   +25  the content and product categories coincide
 *   +20  the product slug appears in the content text (title or caption)
 *   +15  a keyword partially matches a content word (substring, ≥ 4 chars)
 *
 * The accumulated points are normalized to a 0.00–1.00 confidence by
 * `calculateMatchConfidence()` — the result is never above 1.
 *
 * The engine is a PURE function: no I/O, no clock, no randomness — the
 * same inputs always produce the same outputs (pinned by tests).
 */

import {
  MATCH_CATEGORY_POINTS,
  MATCH_KEYWORD_TITLE_POINTS,
  MATCH_PARTIAL_WORD_POINTS,
  MATCH_SLUG_POINTS,
  calculateMatchConfidence,
} from "./scorer";
import type { MatchSourceName } from "./match-source";

/** Default origin stamped on engine-produced matches (rules, not AI). */
export const DEFAULT_MATCH_SOURCE: MatchSourceName = "RULE";

// ------------------------------------------------------------------
// Matchable views (structural — Prisma rows satisfy them as-is)
// ------------------------------------------------------------------

/**
 * The slice of `ExternalContent` the matcher understands. Plain Prisma
 * rows are structurally assignable: `category` is optional because
 * `ExternalContent` has no category column yet — when absent it is
 * derived deterministically from the title (see `deriveContentCategory`).
 */
export interface MatchableContent {
  id: string;
  title: string;
  caption?: string | null;
  /** Explicit category override; derived from the title when missing. */
  category?: string | null;
}

/**
 * The slice of `Product` the matcher understands. Plain Prisma rows are
 * structurally assignable: `category` is derived from the slug and
 * `keywords` from name+slug when not provided explicitly.
 */
export interface MatchableProduct {
  id: string;
  name: string;
  slug: string;
  /** Explicit category override; derived from the slug when missing. */
  category?: string | null;
  /** Explicit keyword override; derived from name+slug when missing. */
  keywords?: readonly string[];
}

/**
 * What the engine produces — the four data columns of a `ProductMatch`
 * row, ready to be persisted through `CreateProductMatchDTO`. Ids and
 * timestamps are the database's business; the engine never fabricates
 * them.
 */
export interface ProductMatchDraft {
  externalContentId: string;
  productId: string;
  /** Normalized confidence, float in [0, 1]. */
  confidence: number;
  matchedBy: MatchSourceName;
}

export interface MatchOptions {
  /** Origin stamped on the drafts (default: `RULE`). */
  matchedBy?: MatchSourceName;
}

// ------------------------------------------------------------------
// Text normalization
// ------------------------------------------------------------------

/** Tokens too generic to carry matching signal. */
const STOPWORDS = new Set([
  "a",
  "as",
  "ao",
  "aos",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "por",
  "que",
  "se",
  "um",
  "uma",
  "the",
  "of",
  "and",
  "for",
  "with",
]);

/** Shortest token that can act as a keyword. */
const MIN_KEYWORD_LENGTH = 3;

/** Shortest fragment that counts as a partial-word match. */
const MIN_PARTIAL_LENGTH = 4;

/**
 * Canonical matching form of any text: lowercase, accent-stripped (NFD),
 * punctuation collapsed to spaces, separators (hyphens included) collapsed
 * to single spaces. "Tênis Chunky" and "tenis-chunky" both become
 * "tenis chunky", so slugs and titles live in the same space.
 */
export function normalizeMatchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

/** A token must contain at least one letter — pure numbers ("001") carry no signal. */
function hasLetter(token: string): boolean {
  return /[a-z]/.test(token);
}

function isSignificant(token: string): boolean {
  return token.length >= MIN_KEYWORD_LENGTH && hasLetter(token) && !STOPWORDS.has(token);
}

/**
 * Extract the matching keywords of a product: the significant tokens of
 * its name and slug, deduplicated, in order of first appearance.
 */
export function extractKeywords(...texts: string[]): string[] {
  const keywords: string[] = [];
  for (const text of texts) {
    for (const token of normalizeMatchText(text).split(" ")) {
      if (isSignificant(token) && !keywords.includes(token)) {
        keywords.push(token);
      }
    }
  }
  return keywords;
}

/** First significant token of a text, or `null` when there is none. */
function firstSignificantToken(text: string): string | null {
  for (const token of normalizeMatchText(text).split(" ")) {
    if (isSignificant(token)) return token;
  }
  return null;
}

/**
 * Category of a content. Explicit category wins; otherwise it is derived
 * deterministically as the first significant token of the title (the mock
 * and real titles lead with the topic noun — "camisa masculina — video
 * 001" → "camisa"). Deterministic: same title, same category, always.
 */
function deriveContentCategory(content: MatchableContent): string | null {
  const explicit = content.category?.trim();
  if (explicit) return normalizeMatchText(explicit) || null;
  return firstSignificantToken(content.title);
}

/**
 * Category of a product. Explicit category wins; otherwise it is derived
 * deterministically as the first significant token of the slug
 * ("camisa-masculina" → "camisa").
 */
function deriveProductCategory(product: MatchableProduct): string | null {
  const explicit = product.category?.trim();
  if (explicit) return normalizeMatchText(explicit) || null;
  return firstSignificantToken(product.slug);
}

// ------------------------------------------------------------------
// Rule checks
// ------------------------------------------------------------------

/** +40 — a product keyword appears as a whole word in the content TITLE. */
function keywordInTitle(keywords: readonly string[], titleTokens: readonly string[]): boolean {
  return keywords.some((keyword) => titleTokens.includes(keyword));
}

/** +25 — both sides expose a category and they coincide. */
function categoryMatches(contentCategory: string | null, productCategory: string | null): boolean {
  return (
    contentCategory !== null && productCategory !== null && contentCategory === productCategory
  );
}

/**
 * +20 — the product slug appears as a contiguous phrase in the content
 * text. `titleText`/`captionText` arrive already normalized.
 */
function slugInText(slug: string, titleText: string, captionText: string | null): boolean {
  const slugText = normalizeMatchText(slug);
  if (slugText.length < MIN_KEYWORD_LENGTH) return false;
  if (titleText.includes(slugText)) return true;
  return captionText !== null && captionText.includes(slugText);
}

/**
 * +15 — a keyword partially matches a content word: one contains the
 * other as a substring (strictly partial — exact words belong to the +40
 * rule), with the contained fragment at least 4 characters long
 * ("hood" ↔ "hoodie", "regatas" ↔ "regata").
 */
function partialWordMatches(keywords: readonly string[], textTokens: readonly string[]): boolean {
  return keywords.some((keyword) =>
    textTokens.some(
      (token) =>
        token !== keyword &&
        ((token.includes(keyword) && keyword.length >= MIN_PARTIAL_LENGTH) ||
          (keyword.includes(token) && token.length >= MIN_PARTIAL_LENGTH)),
    ),
  );
}

// ------------------------------------------------------------------
// Engine
// ------------------------------------------------------------------

/**
 * Match products to external content with deterministic rules.
 *
 * Every (content, product) pair is scored independently; pairs with zero
 * points are discarded. The output is sorted by confidence (desc) with
 * stable id tiebreakers, so the same inputs always yield the same order.
 *
 * @param contents the imported external content (any subset of fields —
 *                 Prisma `ExternalContent[]` works as-is).
 * @param products the tenant's products (Prisma `Product[]` works as-is).
 * @param options  optional origin stamp (default `RULE`).
 * @returns persistence-ready match drafts, best confidence first.
 */
export function matchProductsToContent(
  contents: readonly MatchableContent[],
  products: readonly MatchableProduct[],
  options: MatchOptions = {},
): ProductMatchDraft[] {
  const matchedBy = options.matchedBy ?? DEFAULT_MATCH_SOURCE;

  // Pre-compute the product side once — it is identical for every content.
  const preparedProducts = products.map((product) => {
    const explicit = (product.keywords ?? [])
      .map((keyword) => normalizeMatchText(keyword))
      .filter((keyword) => isSignificant(keyword));
    const keywords = explicit.length > 0 ? explicit : extractKeywords(product.name, product.slug);
    return {
      id: product.id,
      slug: product.slug,
      keywords,
      category: deriveProductCategory(product),
    };
  });

  const drafts: ProductMatchDraft[] = [];

  for (const content of contents) {
    const titleText = normalizeMatchText(content.title);
    const titleTokens = titleText.split(" ").filter(Boolean);
    const captionText = content.caption ? normalizeMatchText(content.caption) : null;
    const captionTokens = captionText ? captionText.split(" ").filter(Boolean) : [];
    const textTokens = [...titleTokens, ...captionTokens];
    const contentCategory = deriveContentCategory(content);

    for (const product of preparedProducts) {
      let score = 0;

      if (keywordInTitle(product.keywords, titleTokens)) {
        score += MATCH_KEYWORD_TITLE_POINTS;
      }
      if (categoryMatches(contentCategory, product.category)) {
        score += MATCH_CATEGORY_POINTS;
      }
      if (slugInText(product.slug, titleText, captionText)) {
        score += MATCH_SLUG_POINTS;
      }
      if (partialWordMatches(product.keywords, textTokens)) {
        score += MATCH_PARTIAL_WORD_POINTS;
      }

      if (score <= 0) continue;

      drafts.push({
        externalContentId: content.id,
        productId: product.id,
        confidence: calculateMatchConfidence(score),
        matchedBy,
      });
    }
  }

  // Best confidence first; ids as stable tiebreakers (deterministic order).
  drafts.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.externalContentId !== b.externalContentId) {
      return a.externalContentId < b.externalContentId ? -1 : 1;
    }
    return a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0;
  });

  return drafts;
}
