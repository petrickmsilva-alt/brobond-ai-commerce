/**
 * Trend Hunter AI — module contracts (PR002).
 *
 * These interfaces are the plug-in surface of the trends module. PR002 ships
 * a **mock collector only** — no TikTok API, no scraping, no OpenAI. A real
 * source implements `TrendCollector` and is returned by
 * `getTrendCollector()` (`modules/trends/hunter/collector.ts`) with zero
 * caller changes.
 */

/**
 * Canonical trend categories tracked by the Trend Hunter. Single source of
 * truth — reused by the collector (mock data), the Zod validators
 * (`trend.validator.ts`), the seed and the dashboard category filter.
 */
export const TREND_CATEGORIES = ["Moda", "Casual", "Street", "Executivo", "Fitness"] as const;

export type TrendCategoryName = (typeof TREND_CATEGORIES)[number];

/**
 * A raw trend signal as collected from a source (mock today; TikTok API /
 * scraping in a future PR). All engagement numbers are plain integers.
 */
export interface TrendSignal {
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

/** The subset of a signal the score engine consumes. */
export type TrendScoreInput = Pick<
  TrendSignal,
  "views" | "likes" | "shares" | "margin" | "saturation"
>;

/** A signal enriched with its 0–100 `trendScore`. */
export interface ScoredTrend extends TrendSignal {
  trendScore: number;
}

/**
 * A trend source. Implementations must be side-effect free and return
 * everything the pipeline needs from `collectDailyTrends()` — PR002
 * deliberately performs **no** network calls anywhere.
 */
export interface TrendCollector {
  /** Stable identifier of the source (e.g. "mock", "tiktok"). */
  readonly source: string;
  /**
   * Collect today's trends. The mock implementation returns exactly 30
   * deterministic signals; a future provider returns live data.
   */
  collectDailyTrends(): Promise<TrendSignal[]>;
}
