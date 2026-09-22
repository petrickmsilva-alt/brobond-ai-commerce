/**
 * Trend Hunter AI — module contracts (PR002 · PR002.1).
 *
 * These interfaces are the plug-in surface of the trends module. PR002
 * shipped a **mock collector only** — no TikTok API, no scraping, no
 * OpenAI. PR002.1 introduced the **multi-source architecture**: every
 * collector declares its `TrendSource`, is resolved exclusively through
 * `getCollector()` (`modules/trends/hunter/collector.factory.ts`) and
 * returns `TrendCandidate[]` from `collect()`.
 */

import type { TrendSource } from "@prisma/client";

/**
 * Canonical trend categories tracked by the Trend Hunter. Single source of
 * truth — reused by the collector (mock data), the Zod validators
 * (`trend.validator.ts`), the seed and the dashboard category filter.
 */
export const TREND_CATEGORIES = ["Moda", "Casual", "Street", "Executivo", "Fitness"] as const;

export type TrendCategoryName = (typeof TREND_CATEGORIES)[number];

/**
 * PR002.1 — the trend data sources. Kept in sync with the Prisma
 * `TrendSource` enum (`prisma/schema.prisma`); the sync is pinned by
 * `tests/trend-source.test.ts`.
 *
 * Client-safe on purpose: the dashboard toolbar imports this list to render
 * the "Origem" filter (this file must never import `@prisma/client` as a
 * runtime value — only as a type).
 */
export const TREND_SOURCES = ["MOCK", "TIKTOK", "SHOPEE", "INSTAGRAM", "MANUAL"] as const;

export type TrendSourceName = (typeof TREND_SOURCES)[number];

/**
 * The default source. Every snapshot created before PR002.1 (and every
 * payload that does not specify one) is MOCK-sourced — this is what makes
 * the change retrocompatible.
 */
export const DEFAULT_TREND_SOURCE: TrendSourceName = "MOCK";

/** pt-BR display labels for the dashboard "Origem" filter. */
export const TREND_SOURCE_LABELS: Record<TrendSourceName, string> = {
  MOCK: "Mock",
  TIKTOK: "TikTok",
  SHOPEE: "Shopee",
  INSTAGRAM: "Instagram",
  MANUAL: "Manual",
};

/**
 * A raw trend candidate as collected from a source (mock today; TikTok /
 * Shopee / Instagram API in a future PR). All engagement numbers are plain
 * integers. Named `TrendCandidate` since PR002.1 — PR002 called this same
 * shape `TrendSignal` (the alias below is kept for retrocompatibility).
 */
export interface TrendCandidate {
  /** Product keyword, e.g. "camisa masculina". */
  keyword: string;
  category: TrendCategoryName;
  /** Views for the period. */
  views: number;
  /** Likes for the period. */
  likes: number;
  /** Shares for the period. */
  shares: number;
  /** Estimated gross margin of the product, in percent (0–100). */
  margin: number;
  /** Market saturation, in percent (0–100). Lower = more attractive. */
  saturation: number;
}

/** Retrocompatible PR002 name for `TrendCandidate`. */
export type TrendSignal = TrendCandidate;

/** The subset of a candidate the score engine consumes. */
export type TrendScoreInput = Pick<
  TrendCandidate,
  "views" | "likes" | "shares" | "margin" | "saturation"
>;

/** A candidate enriched with its 0–100 `trendScore`. */
export interface ScoredTrend extends TrendCandidate {
  trendScore: number;
}

/**
 * A trend data source (PR002.1 contract). Implementations must be
 * side-effect free and return everything the pipeline needs from
 * `collect()` — they are resolved through `getCollector(source)`, never
 * instantiated ad hoc by callers and never chosen via a `switch`.
 */
export interface TrendCollector {
  /** Which source this collector fetches from (Prisma `TrendSource`). */
  readonly source: TrendSource;
  /**
   * Collect today's trends. The mock implementation returns exactly 30
   * deterministic candidates; a real provider returns live data.
   */
  collect(): Promise<TrendCandidate[]>;
  /**
   * PR002 retrocompatible alias of `collect()` — kept so PR002-era callers
   * and implementations keep working unchanged. New code calls `collect()`.
   */
  collectDailyTrends?(): Promise<TrendCandidate[]>;
}

/**
 * Invoke a collector through its canonical `collect()` (PR002.1), falling
 * back to the PR002 `collectDailyTrends()` alias when only that exists.
 * This is what keeps the scheduler compatible with both generations of
 * collectors.
 */
export async function collectTrendCandidates(collector: TrendCollector): Promise<TrendCandidate[]> {
  if (typeof collector.collect === "function") return collector.collect();
  const legacy = collector.collectDailyTrends;
  if (typeof legacy === "function") return legacy();
  throw new Error("TrendCollector must implement collect() (or the collectDailyTrends() alias).");
}
