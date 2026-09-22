/**
 * Creator Collector Factory (PR003) — the SINGLE point where a
 * `CreatorSource` resolves to its `CreatorCollector`.
 *
 * `getCreatorCollector(source)` is the only supported way to obtain a
 * collector; mapping an origin to an implementation must never happen
 * through a `switch` (or an `if` chain) outside this factory. Adding a new
 * source means: implement the collector in `collectors/`, register it in
 * the map below — done. Zero caller changes.
 *
 * `MANUAL` deliberately has no collector: manual profiles are created
 * through the CRM form, never collected, so
 * `getCreatorCollector(CreatorSource.MANUAL)` throws.
 */

import { CreatorSource } from "@prisma/client";
import type { CreatorCollector } from "../interfaces/creator.interface";
import { InstagramCreatorCollector } from "./collectors/InstagramCreatorCollector";
import { MockCreatorCollector } from "./collectors/MockCreatorCollector";
import { ShopeeCreatorCollector } from "./collectors/ShopeeCreatorCollector";
import { TikTokCreatorCollector } from "./collectors/TikTokCreatorCollector";

/**
 * Source → collector builder map. Instances are cached per source so the
 * factory is stable
 * (`getCreatorCollector(CreatorSource.MOCK) === getDefaultCreatorCollector()`).
 */
const COLLECTOR_BUILDERS: Partial<Record<CreatorSource, () => CreatorCollector>> = {
  MOCK: () => new MockCreatorCollector(),
  TIKTOK: () => new TikTokCreatorCollector(),
  INSTAGRAM: () => new InstagramCreatorCollector(),
  SHOPEE: () => new ShopeeCreatorCollector(),
};

const instances = new Map<CreatorSource, CreatorCollector>();

/**
 * Resolve the collector for a source (lazy singleton per source).
 *
 * @throws {Error} for `MANUAL` (no collector by design) and for any
 * unregistered source at runtime.
 */
export function getCreatorCollector(source: CreatorSource): CreatorCollector {
  const cached = instances.get(source);
  if (cached) return cached;

  const build = COLLECTOR_BUILDERS[source];
  if (!build) {
    throw new Error(
      source === CreatorSource.MANUAL
        ? 'No CreatorCollector is registered for source "MANUAL" — manual profiles are created through the CRM form, not collected.'
        : `No CreatorCollector is registered for source "${String(source)}".`,
    );
  }

  const instance = build();
  instances.set(source, instance);
  return instance;
}

/**
 * The configured (mock) collector — the PR003 default source. Equivalent
 * to `getCreatorCollector(CreatorSource.MOCK)`.
 */
export function getDefaultCreatorCollector(): CreatorCollector {
  return getCreatorCollector(CreatorSource.MOCK);
}
