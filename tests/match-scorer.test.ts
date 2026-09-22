import { describe, expect, it } from "vitest";
import {
  MATCH_CATEGORY_POINTS,
  MATCH_KEYWORD_TITLE_POINTS,
  MATCH_MAX_POINTS,
  MATCH_PARTIAL_WORD_POINTS,
  MATCH_RULE_WEIGHTS,
  MATCH_SLUG_POINTS,
  calculateMatchConfidence,
} from "@/modules/campaigns/matching/scorer";

/**
 * PR005.1 — Confidence Score.
 *
 * `calculateMatchConfidence()` is the single normalization path from rule
 * points to the persisted `ProductMatch.confidence` float. These tests pin
 * the hard contract: the result is a float between 0.00 and 1.00 — NEVER
 * above 1 — no matter the input (examples: 0.98 · 0.76 · 0.52).
 */

describe("match rule weights", () => {
  it("awards +40 when a keyword appears in the title", () => {
    expect(MATCH_KEYWORD_TITLE_POINTS).toBe(40);
  });

  it("awards +25 when the category coincides", () => {
    expect(MATCH_CATEGORY_POINTS).toBe(25);
  });

  it("awards +20 when the slug coincides", () => {
    expect(MATCH_SLUG_POINTS).toBe(20);
  });

  it("awards +15 for a partial word match", () => {
    expect(MATCH_PARTIAL_WORD_POINTS).toBe(15);
  });

  it("sums the four rules to exactly 100 points (full confidence)", () => {
    expect(MATCH_MAX_POINTS).toBe(100);
    expect(
      MATCH_KEYWORD_TITLE_POINTS +
        MATCH_CATEGORY_POINTS +
        MATCH_SLUG_POINTS +
        MATCH_PARTIAL_WORD_POINTS,
    ).toBe(MATCH_MAX_POINTS);
  });

  it("exposes the weights as a single source of truth", () => {
    expect(MATCH_RULE_WEIGHTS).toEqual({
      keywordInTitle: 40,
      category: 25,
      slug: 20,
      partialWord: 15,
    });
  });
});

describe("calculateMatchConfidence", () => {
  it("normalizes the spec examples to two-decimal floats", () => {
    expect(calculateMatchConfidence(98)).toBe(0.98);
    expect(calculateMatchConfidence(76)).toBe(0.76);
    expect(calculateMatchConfidence(52)).toBe(0.52);
  });

  it("maps a perfect score to exactly 1", () => {
    expect(calculateMatchConfidence(100)).toBe(1);
  });

  it("maps zero to zero", () => {
    expect(calculateMatchConfidence(0)).toBe(0);
  });

  it("rounds to two decimal places (stable persisted value)", () => {
    expect(calculateMatchConfidence(55.4)).toBe(0.55);
    expect(calculateMatchConfidence(55.6)).toBe(0.56);
    expect(calculateMatchConfidence(98.76)).toBe(0.99);
  });

  it("NEVER returns above 1 — scores above the maximum are clamped", () => {
    expect(calculateMatchConfidence(101)).toBe(1);
    expect(calculateMatchConfidence(140)).toBe(1);
    expect(calculateMatchConfidence(1_000_000)).toBe(1);
  });

  it("never returns below 0 — negative scores are clamped", () => {
    expect(calculateMatchConfidence(-3)).toBe(0);
    expect(calculateMatchConfidence(-0.01)).toBe(0);
  });

  it("collapses non-finite input to 0 instead of throwing", () => {
    expect(calculateMatchConfidence(Number.NaN)).toBe(0);
    expect(calculateMatchConfidence(Number.POSITIVE_INFINITY)).toBe(0);
    expect(calculateMatchConfidence(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("collapses an invalid maximum to 0 (never divides by zero)", () => {
    expect(calculateMatchConfidence(50, 0)).toBe(0);
    expect(calculateMatchConfidence(50, -10)).toBe(0);
    expect(calculateMatchConfidence(50, Number.NaN)).toBe(0);
  });

  it("supports a custom maximum (relative confidence)", () => {
    expect(calculateMatchConfidence(50, 200)).toBe(0.25);
    expect(calculateMatchConfidence(150, 200)).toBe(0.75);
    expect(calculateMatchConfidence(200, 200)).toBe(1);
  });

  it("returns a float for every integer score in the rule range", () => {
    for (let points = 0; points <= 120; points += 1) {
      const confidence = calculateMatchConfidence(points);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
      // Exactly representable at two decimals: no 0.30000000000000004 artifacts.
      expect(confidence * 100).toBeCloseTo(Math.round(confidence * 100), 10);
    }
  });

  it("is deterministic — the same input always yields the same output", () => {
    const first = Array.from({ length: 10 }, (_, i) => calculateMatchConfidence(i * 11));
    const second = Array.from({ length: 10 }, (_, i) => calculateMatchConfidence(i * 11));
    expect(first).toEqual(second);
  });
});
