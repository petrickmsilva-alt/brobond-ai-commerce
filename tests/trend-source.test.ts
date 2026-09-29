import { describe, expect, it } from "vitest";
import { TrendSource } from "@prisma/client";
import {
  DEFAULT_TREND_SOURCE,
  TREND_SOURCE_LABELS,
  TREND_SOURCES,
} from "@/modules/trends/interfaces/trend.interface";
import {
  createTrendSchema,
  trendListQuerySchema,
  trendSignalSchema,
  trendSourceSchema,
} from "@/modules/trends/validators/trend.validator";

/**
 * PR002.1 — the TrendSource enum and its TypeScript mirrors.
 *
 * The enum exists in THREE places that must never drift apart:
 *   1. Prisma (`enum TrendSource` in prisma/schema.prisma — the database);
 *   2. `TREND_SOURCES` (modules/trends/interfaces — client-safe const);
 *   3. the Zod schemas (modules/trends/validators — every write path).
 *
 * These tests pin all three to the exact five values, plus the retro-
 * compatibility contract: MOCK is the default everywhere, so data created
 * before PR002.1 keeps its meaning.
 */

describe("TrendSource (Prisma enum)", () => {
  it("has exactly the five PR002.1 values", () => {
    expect(Object.values(TrendSource)).toEqual(["MOCK", "TIKTOK", "SHOPEE", "INSTAGRAM", "MANUAL"]);
  });

  it("maps each value to itself (string enum)", () => {
    expect(TrendSource.MOCK).toBe("MOCK");
    expect(TrendSource.TIKTOK).toBe("TIKTOK");
    expect(TrendSource.SHOPEE).toBe("SHOPEE");
    expect(TrendSource.INSTAGRAM).toBe("INSTAGRAM");
    expect(TrendSource.MANUAL).toBe("MANUAL");
  });
});

describe("TREND_SOURCES (client-safe mirror)", () => {
  it("is in sync with the Prisma enum (drift breaks the dashboard filter)", () => {
    expect([...TREND_SOURCES]).toEqual(Object.values(TrendSource));
  });

  it("is frozen at exactly the five values", () => {
    expect(TREND_SOURCES).toHaveLength(5);
    expect(new Set(TREND_SOURCES).size).toBe(5);
  });

  it("has a pt-BR display label for every source", () => {
    for (const source of TREND_SOURCES) {
      expect(typeof TREND_SOURCE_LABELS[source]).toBe("string");
      expect(TREND_SOURCE_LABELS[source].length).toBeGreaterThan(0);
    }
  });

  it("labels match the dashboard 'Origem' filter options", () => {
    expect(TREND_SOURCE_LABELS.MOCK).toBe("Mock");
    expect(TREND_SOURCE_LABELS.TIKTOK).toBe("TikTok");
    expect(TREND_SOURCE_LABELS.SHOPEE).toBe("Shopee");
    expect(TREND_SOURCE_LABELS.INSTAGRAM).toBe("Instagram");
    expect(TREND_SOURCE_LABELS.MANUAL).toBe("Manual");
  });

  it("defaults to MOCK (retrocompatibility with pre-PR002.1 data)", () => {
    expect(DEFAULT_TREND_SOURCE).toBe("MOCK");
    expect(DEFAULT_TREND_SOURCE).toBe(TrendSource.MOCK);
  });
});

describe("trendSourceSchema (Zod)", () => {
  it("accepts every valid source", () => {
    for (const source of TREND_SOURCES) {
      expect(trendSourceSchema.parse(source)).toBe(source);
    }
  });

  it("rejects invalid sources", () => {
    const invalid = ["", "mock", "tiktok", "test", "unknown", "MANUAL ", "0"];
    for (const value of invalid) {
      expect(() => trendSourceSchema.parse(value)).toThrow();
    }
  });

  it("rejects non-string values", () => {
    expect(() => trendSourceSchema.parse(1)).toThrow();
    expect(() => trendSourceSchema.parse(null)).toThrow();
    expect(() => trendSourceSchema.parse(undefined)).toThrow();
  });
});

describe("createTrendSchema — source (persistence payload)", () => {
  const SIGNAL = {
    keyword: "camisa masculina",
    category: "Moda",
    views: 1_000_000,
    likes: 200_000,
    shares: 30_000,
    trendScore: 85,
  };

  it("defaults the source to MOCK when absent (retrocompatible)", () => {
    expect(createTrendSchema.parse(SIGNAL).source).toBe(TrendSource.MOCK);
  });

  it("accepts an explicit source", () => {
    for (const source of TREND_SOURCES) {
      expect(createTrendSchema.parse({ ...SIGNAL, source }).source).toBe(source);
    }
  });

  it("rejects an invalid source instead of guessing", () => {
    expect(() => createTrendSchema.parse({ ...SIGNAL, source: "tiktok" })).toThrow();
  });

  it("every mock signal still parses (existing pipeline unaffected)", () => {
    // Pre-PR002.1 payloads carried no source — they must keep parsing.
    expect(createTrendSchema.parse(SIGNAL).keyword).toBe("camisa masculina");
  });
});

describe("trendSignalSchema — unchanged by PR002.1", () => {
  it("does NOT accept a source (manual form never sends one)", () => {
    // The action stamps MANUAL server-side; the client input stays source-less.
    const parsed = trendSignalSchema.parse({
      keyword: "camisa masculina",
      category: "Moda",
      views: 1,
      likes: 1,
      shares: 1,
      margin: 10,
      saturation: 10,
    });
    expect("source" in parsed).toBe(false);
  });
});

describe("trendListQuerySchema — source filter (dashboard URL state)", () => {
  it("is optional — no source means all sources (Todos)", () => {
    const query = trendListQuerySchema.parse({});
    expect(query.source).toBeUndefined();
  });

  it("parses a valid source from the URL", () => {
    expect(trendListQuerySchema.parse({ source: "TIKTOK" }).source).toBe("TIKTOK");
    expect(trendListQuerySchema.parse({ source: "MANUAL" }).source).toBe("MANUAL");
  });

  it("falls back to undefined on an invalid source (never a 500)", () => {
    expect(trendListQuerySchema.parse({ source: "nope" }).source).toBeUndefined();
    expect(trendListQuerySchema.parse({ source: "" }).source).toBeUndefined();
  });

  it("combines with the other filters without interference", () => {
    const query = trendListQuerySchema.parse({
      search: "camisa",
      category: "Moda",
      source: "MOCK",
      page: "2",
    });
    expect(query.source).toBe("MOCK");
    expect(query.category).toBe("Moda");
    expect(query.search).toBe("camisa");
    expect(query.page).toBe(2);
  });
});
