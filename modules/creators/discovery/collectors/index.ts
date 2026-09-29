/**
 * Creator collectors — one implementation per `CreatorSource` (PR003).
 *
 * | Class                     | Source      | Status                              |
 * | ------------------------- | ----------- | ----------------------------------- |
 * | `MockCreatorCollector`    | `MOCK`      | ✅ implemented (100 candidates)     |
 * | `TikTokCreatorCollector`  | `TIKTOK`    | 🧩 placeholder ("Not implemented")  |
 * | `InstagramCreatorCollector` | `INSTAGRAM` | 🧩 placeholder ("Not implemented") |
 * | `ShopeeCreatorCollector`  | `SHOPEE`    | 🧩 placeholder ("Not implemented")  |
 *
 * `MANUAL` has no collector by design — manual profiles are created through
 * the CRM form (`app/dashboard/creators/actions.ts`).
 *
 * Callers must NOT import or instantiate collectors directly: resolve them
 * through `getCreatorCollector(source)`
 * (`modules/creators/discovery/collector.factory.ts`).
 */

export {
  MOCK_CREATOR_CANDIDATES,
  MOCK_CREATOR_SIGNALS,
  MOCK_DATASET_SEED,
  MOCK_FOLLOWERS_MAX,
  MOCK_FOLLOWERS_MIN,
  MOCK_NICHE_DISTRIBUTION,
  MockCollector,
  MockCreatorCollector,
} from "./MockCreatorCollector";
export { InstagramCreatorCollector } from "./InstagramCreatorCollector";
export { ShopeeCreatorCollector } from "./ShopeeCreatorCollector";
export { TikTokCreatorCollector } from "./TikTokCreatorCollector";
