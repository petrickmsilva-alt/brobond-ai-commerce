/**
 * Product Matching Engine (PR005.1) — public surface.
 *
 * Deterministic rules only: no OpenAI, no computer vision, no embeddings,
 * no TikTok integration. See `matcher.ts` for the rule table.
 */
export * from "./match-source";
export * from "./scorer";
export * from "./matcher";
