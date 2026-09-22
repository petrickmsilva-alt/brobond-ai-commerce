import { describe, expect, it } from "vitest";
import {
  MOCK_TREND_SIGNALS,
  MockTrendCollector,
  getTrendCollector,
} from "@/modules/trends/hunter/collector";
import { scoreTrend } from "@/modules/trends/hunter/scorer";
import { TREND_CATEGORIES } from "@/modules/trends/interfaces/trend.interface";
import { createTrendSchema, trendSignalSchema } from "@/modules/trends/validators/trend.validator";

/**
 * PR002 — Mock Trend Collector.
 *
 * The collector is the ONLY source of trend data in PR002 (no TikTok API,
 * no scraping). These tests pin its contract: exactly 30 valid, unique,
 * deterministic signals across the 5 tracked categories, whose scores land
 * in the 60–98 band used by the seed.
 */

const SPEC_KEYWORDS = [
  "camisa masculina",
  "jaqueta premium",
  "bermuda cargo",
  "camiseta oversized",
  "polo slim",
];

describe("MOCK_TREND_SIGNALS", () => {
  it("contains exactly 30 trends", () => {
    expect(MOCK_TREND_SIGNALS).toHaveLength(30);
  });

  it("is frozen (module state can never be mutated)", () => {
    expect(Object.isFrozen(MOCK_TREND_SIGNALS)).toBe(true);
  });

  it("has unique keywords", () => {
    const keywords = MOCK_TREND_SIGNALS.map((signal) => signal.keyword);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("uses only the 5 tracked categories — and all of them appear", () => {
    const categories = new Set(MOCK_TREND_SIGNALS.map((signal) => signal.category));
    expect([...categories].sort()).toEqual([...TREND_CATEGORIES].sort());
  });

  it("includes the keywords given as examples in the PR002 spec", () => {
    const keywords = new Set(MOCK_TREND_SIGNALS.map((signal) => signal.keyword));
    for (const keyword of SPEC_KEYWORDS) {
      expect(keywords.has(keyword)).toBe(true);
    }
  });

  it("every signal passes trendSignalSchema (valid pipeline input)", () => {
    for (const signal of MOCK_TREND_SIGNALS) {
      expect(trendSignalSchema.parse(signal)).toBeTruthy();
    }
  });

  it("every scored signal passes createTrendSchema (valid persistence payload)", () => {
    for (const signal of MOCK_TREND_SIGNALS) {
      expect(
        createTrendSchema.parse({ ...signal, trendScore: scoreTrend(signal).trendScore }),
      ).toBeTruthy();
    }
  });

  it("scores distribute between 60 and 98 (the seed band)", () => {
    const scores = MOCK_TREND_SIGNALS.map((signal) => scoreTrend(signal).trendScore);
    for (const score of scores) {
      expect(score).toBeGreaterThanOrEqual(60);
      expect(score).toBeLessThanOrEqual(98);
    }
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(60);
    expect(Math.max(...scores)).toBeLessThanOrEqual(98);
  });

  it("covers the full 5-category distribution (6 trends per category)", () => {
    const counts = new Map<string, number>();
    for (const signal of MOCK_TREND_SIGNALS) {
      counts.set(signal.category, (counts.get(signal.category) ?? 0) + 1);
    }
    for (const category of TREND_CATEGORIES) {
      expect(counts.get(category)).toBe(6);
    }
  });
});

describe("MockTrendCollector", () => {
  it("implements the TrendCollector interface with source 'mock'", () => {
    const collector = new MockTrendCollector();
    expect(collector.source).toBe("mock");
    expect(typeof collector.collectDailyTrends).toBe("function");
  });

  it("collectDailyTrends() returns exactly 30 trends", async () => {
    const trends = await new MockTrendCollector().collectDailyTrends();
    expect(trends).toHaveLength(30);
  });

  it("is deterministic (two runs are deeply equal)", async () => {
    const collector = new MockTrendCollector();
    const [first, second] = await Promise.all([
      collector.collectDailyTrends(),
      collector.collectDailyTrends(),
    ]);
    expect(first).toEqual(second);
  });

  it("returns defensive copies (mutating a result never leaks into the source)", async () => {
    const collector = new MockTrendCollector();
    const first = await collector.collectDailyTrends();
    first[0]!.keyword = "HACKED";
    first.pop();
    const second = await collector.collectDailyTrends();
    expect(second).toHaveLength(30);
    expect(second[0]?.keyword).not.toBe("HACKED");
    expect(MOCK_TREND_SIGNALS[0]?.keyword).not.toBe("HACKED");
  });
});

describe("getTrendCollector()", () => {
  it("returns the mock collector (PR002 ships no external source)", () => {
    const collector = getTrendCollector();
    expect(collector.source).toBe("mock");
    expect(collector).toBeInstanceOf(MockTrendCollector);
  });

  it("is a singleton (stable instance)", () => {
    expect(getTrendCollector()).toBe(getTrendCollector());
  });
});
