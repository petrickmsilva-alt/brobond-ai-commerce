/**
 * Mock Trend Collector (PR002 · PR002.1).
 *
 * IMPORTANT: the Trend Hunter intentionally performs **no** network access
 * in this PR — no TikTok API, no scraping, no OpenAI. `MOCK_TREND_SIGNALS`
 * below is a realistic, deterministic dataset (30 daily trends across the
 * 5 tracked categories) so the whole pipeline — collector → score engine →
 * repository → dashboard — works end-to-end today.
 *
 * PR002.1: this is the MOCK implementation of the multi-source
 * `TrendCollector` contract. Real sources live beside it
 * (`TikTokCollector.ts`, `ShopeeCollector.ts`, `InstagramCollector.ts`)
 * and are resolved through `getCollector()` — never instantiated ad hoc.
 */

import { TrendSource } from "@prisma/client";
import type { TrendCandidate, TrendCollector } from "../../interfaces/trend.interface";

export const MOCK_TREND_SIGNALS: readonly TrendCandidate[] = Object.freeze([
  // Moda
  {
    keyword: "camisa masculina",
    category: "Moda",
    views: 1_850_000,
    likes: 320_000,
    shares: 48_000,
    margin: 62,
    saturation: 22,
  },
  {
    keyword: "jaqueta premium",
    category: "Moda",
    views: 1_150_000,
    likes: 236_000,
    shares: 33_500,
    margin: 82,
    saturation: 10,
  },
  {
    keyword: "blazer alfaiataria",
    category: "Moda",
    views: 780_000,
    likes: 148_000,
    shares: 19_500,
    margin: 56,
    saturation: 26,
  },
  {
    keyword: "camisa social slim",
    category: "Moda",
    views: 830_000,
    likes: 160_000,
    shares: 22_000,
    margin: 54,
    saturation: 30,
  },
  {
    keyword: "tricot masculino",
    category: "Moda",
    views: 860_000,
    likes: 168_000,
    shares: 24_000,
    margin: 52,
    saturation: 35,
  },
  {
    keyword: "sobretudo masculino",
    category: "Moda",
    views: 690_000,
    likes: 134_000,
    shares: 18_900,
    margin: 70,
    saturation: 22,
  },

  // Casual
  {
    keyword: "bermuda cargo",
    category: "Casual",
    views: 1_720_000,
    likes: 310_000,
    shares: 44_000,
    margin: 55,
    saturation: 15,
  },
  {
    keyword: "camiseta oversized",
    category: "Casual",
    views: 2_300_000,
    likes: 420_000,
    shares: 61_000,
    margin: 45,
    saturation: 12,
  },
  {
    keyword: "polo slim",
    category: "Casual",
    views: 980_000,
    likes: 196_000,
    shares: 27_500,
    margin: 60,
    saturation: 25,
  },
  {
    keyword: "moletom com capuz",
    category: "Casual",
    views: 1_310_000,
    likes: 258_000,
    shares: 36_500,
    margin: 50,
    saturation: 20,
  },
  {
    keyword: "calça jogger",
    category: "Casual",
    views: 1_020_000,
    likes: 205_000,
    shares: 28_800,
    margin: 47,
    saturation: 33,
  },
  {
    keyword: "camiseta básica algodão",
    category: "Casual",
    views: 2_150_000,
    likes: 396_000,
    shares: 56_500,
    margin: 38,
    saturation: 10,
  },

  // Street
  {
    keyword: "hoodie oversized",
    category: "Street",
    views: 3_200_000,
    likes: 560_000,
    shares: 82_000,
    margin: 44,
    saturation: 8,
  },
  {
    keyword: "calça cargo baggy",
    category: "Street",
    views: 1_680_000,
    likes: 302_000,
    shares: 44_500,
    margin: 46,
    saturation: 14,
  },
  {
    keyword: "jaqueta corta-vento",
    category: "Street",
    views: 890_000,
    likes: 178_000,
    shares: 24_200,
    margin: 52,
    saturation: 24,
  },
  {
    keyword: "camiseta estampada street",
    category: "Street",
    views: 1_120_000,
    likes: 224_000,
    shares: 31_000,
    margin: 42,
    saturation: 30,
  },
  {
    keyword: "boné aba reta",
    category: "Street",
    views: 760_000,
    likes: 148_000,
    shares: 20_400,
    margin: 63,
    saturation: 35,
  },
  {
    keyword: "tênis chunky",
    category: "Street",
    views: 4_200_000,
    likes: 740_000,
    shares: 108_000,
    margin: 78,
    saturation: 5,
  },

  // Executivo
  {
    keyword: "terno slim fit",
    category: "Executivo",
    views: 720_000,
    likes: 138_000,
    shares: 19_200,
    margin: 74,
    saturation: 26,
  },
  {
    keyword: "camisa executiva",
    category: "Executivo",
    views: 740_000,
    likes: 148_000,
    shares: 21_600,
    margin: 68,
    saturation: 32,
  },
  {
    keyword: "sapato social couro",
    category: "Executivo",
    views: 920_000,
    likes: 186_000,
    shares: 27_400,
    margin: 74,
    saturation: 22,
  },
  {
    keyword: "cinto de couro executivo",
    category: "Executivo",
    views: 720_000,
    likes: 138_000,
    shares: 19_200,
    margin: 72,
    saturation: 38,
  },
  {
    keyword: "relógio minimalista",
    category: "Executivo",
    views: 1_540_000,
    likes: 292_000,
    shares: 43_000,
    margin: 66,
    saturation: 18,
  },
  {
    keyword: "meia alfaiataria",
    category: "Executivo",
    views: 760_000,
    likes: 148_000,
    shares: 21_000,
    margin: 70,
    saturation: 42,
  },

  // Fitness
  {
    keyword: "regata fitness",
    category: "Fitness",
    views: 1_750_000,
    likes: 318_000,
    shares: 46_500,
    margin: 54,
    saturation: 16,
  },
  {
    keyword: "calça de treino masculina",
    category: "Fitness",
    views: 1_080_000,
    likes: 214_000,
    shares: 30_200,
    margin: 56,
    saturation: 27,
  },
  {
    keyword: "camiseta dry fit",
    category: "Fitness",
    views: 2_320_000,
    likes: 428_000,
    shares: 60_500,
    margin: 42,
    saturation: 11,
  },
  {
    keyword: "bermuda squash",
    category: "Fitness",
    views: 820_000,
    likes: 158_000,
    shares: 22_400,
    margin: 53,
    saturation: 32,
  },
  {
    keyword: "tênis de corrida",
    category: "Fitness",
    views: 3_600_000,
    likes: 645_000,
    shares: 95_000,
    margin: 48,
    saturation: 9,
  },
  {
    keyword: "mochila de academia",
    category: "Fitness",
    views: 760_000,
    likes: 148_000,
    shares: 20_800,
    margin: 60,
    saturation: 38,
  },
]);

/**
 * MOCK implementation of `TrendCollector`. Returns **defensive copies** of
 * the frozen dataset so callers can never mutate the module state.
 */
export class MockCollector implements TrendCollector {
  readonly source: TrendSource = TrendSource.MOCK;

  async collect(): Promise<TrendCandidate[]> {
    return MOCK_TREND_SIGNALS.map((signal) => ({ ...signal }));
  }

  /** PR002 retrocompatible alias — same data, same promise. */
  collectDailyTrends(): Promise<TrendCandidate[]> {
    return this.collect();
  }
}

/** Retrocompatible PR002 name (`MockTrendCollector`). */
export { MockCollector as MockTrendCollector };
