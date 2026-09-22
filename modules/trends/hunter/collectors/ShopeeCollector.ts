/**
 * Shopee Trend Collector — PLACEHOLDER (PR002.1).
 *
 * Reserved for the real Shopee source: trending product keywords from the
 * marketplace's search/insights surfaces. The contract is already pinned
 * here and tested, so wiring the real implementation must not touch any
 * caller — `getCollector(TrendSource.SHOPEE)` keeps resolving to this
 * class until then.
 *
 * No network access is performed in PR002.1 — by design.
 */

import { TrendSource } from "@prisma/client";
import type { TrendCandidate, TrendCollector } from "../../interfaces/trend.interface";

export class ShopeeCollector implements TrendCollector {
  readonly source: TrendSource = TrendSource.SHOPEE;

  async collect(): Promise<TrendCandidate[]> {
    throw new Error("Not implemented");
  }

  /** PR002 retrocompatible alias — same placeholder behaviour. */
  collectDailyTrends(): Promise<TrendCandidate[]> {
    return this.collect();
  }
}
