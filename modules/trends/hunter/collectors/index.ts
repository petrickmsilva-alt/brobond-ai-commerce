/**
 * Trend collectors — one implementation per `TrendSource` (PR002.1).
 *
 * | Class                | Source      | Status                              |
 * | -------------------- | ----------- | ----------------------------------- |
 * | `MockCollector`      | `MOCK`      | ✅ implemented (30 signals/day)     |
 * | `TikTokCollector`    | `TIKTOK`    | 🧩 placeholder ("Not implemented")  |
 * | `ShopeeCollector`    | `SHOPEE`    | 🧩 placeholder ("Not implemented")  |
 * | `InstagramCollector` | `INSTAGRAM` | 🧩 placeholder ("Not implemented")  |
 *
 * `MANUAL` has no collector by design — manual trends are created through
 * the dashboard form (`app/dashboard/trends/actions.ts`).
 *
 * Callers must NOT import or instantiate collectors directly: resolve them
 * through `getCollector(source)` (`modules/trends/hunter/collector.factory.ts`).
 */

export { MOCK_TREND_SIGNALS, MockCollector, MockTrendCollector } from "./MockCollector";
export { TikTokCollector } from "./TikTokCollector";
export { ShopeeCollector } from "./ShopeeCollector";
export { InstagramCollector } from "./InstagramCollector";
