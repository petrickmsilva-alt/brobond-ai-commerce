/**
 * Trend collectors — one implementation per `TrendSource` (PR002.1 / PR012).
 *
 * | Class                | Source      | Status                              |
 * | -------------------- | ----------- | ----------------------------------- |
 * | `MockCollector`      | `MOCK`      | ✅ implemented (30 signals/day)     |
 * | `TikTokCollector`    | `TIKTOK`    | ✅ implemented (TikTok Trends API)  |
 * | `ShopeeCollector`    | `SHOPEE`    | ✅ implemented (Shopee Keywords API)|
 * | `InstagramCollector` | `INSTAGRAM` | ✅ implemented (Meta Graph API)     |
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
