/**
 * Collector Factory (PR002.1) — the SINGLE point where a `TrendSource`
 * resolves to its `TrendCollector`.
 *
 * `getCollector(source)` is the only supported way to obtain a collector;
 * mapping an origin to an implementation must never happen through a
 * `switch` (or an `if` chain) outside this factory. Adding a new source
 * means: implement the collector in `collectors/`, register it in the map
 * below — done. Zero caller changes.
 *
 * `MANUAL` deliberately has no collector: manual trends are created through
 * the dashboard form, never collected, so `getCollector(TrendSource.MANUAL)`
 * throws.
 */

import { TrendSource } from "@prisma/client";
import type { TrendCollector } from "../interfaces/trend.interface";
import { InstagramCollector } from "./collectors/InstagramCollector";
import { MockCollector } from "./collectors/MockCollector";
import { ShopeeCollector } from "./collectors/ShopeeCollector";
import { TikTokCollector } from "./collectors/TikTokCollector";

/**
 * Source → collector builder map. Instances are cached per source so the
 * factory is stable (`getCollector(MOCK) === getTrendCollector()`).
 */
const COLLECTOR_BUILDERS: Partial<Record<TrendSource, () => TrendCollector>> = {
  MOCK: () => new MockCollector(),
  TIKTOK: () => new TikTokCollector(),
  SHOPEE: () => new ShopeeCollector(),
  INSTAGRAM: () => new InstagramCollector(),
};

const instances = new Map<TrendSource, TrendCollector>();

/**
 * Resolve the collector for a source (lazy singleton per source).
 *
 * @throws {Error} for `MANUAL` (no collector by design) and for any
 * unregistered source at runtime.
 */
export function getCollector(source: TrendSource): TrendCollector {
  const cached = instances.get(source);
  if (cached) return cached;

  const build = COLLECTOR_BUILDERS[source];
  if (!build) {
    throw new Error(
      source === TrendSource.MANUAL
        ? 'No TrendCollector is registered for source "MANUAL" — manual trends are created through the dashboard form, not collected.'
        : `No TrendCollector is registered for source "${String(source)}".`,
    );
  }

  const instance = build();
  instances.set(source, instance);
  return instance;
}

/**
 * PR002 retrocompatible resolver — the configured (mock) collector.
 * Equivalent to `getCollector(TrendSource.MOCK)`.
 */
export function getTrendCollector(): TrendCollector {
  return getCollector(TrendSource.MOCK);
}
