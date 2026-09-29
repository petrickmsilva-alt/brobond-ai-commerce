/**
 * Connector Framework (PR005).
 *
 * Multi-platform architecture for importing external content into a
 * workspace. PR005 delivers the ARCHITECTURE ONLY — no real API is
 * integrated:
 *
 * | Adapter              | Platform    | Status                             |
 * | -------------------- | ----------- | ---------------------------------- |
 * | `MockConnector`      | `MOCK`      | ✅ implemented (40 deterministic)  |
 * | `TikTokConnector`    | `TIKTOK`    | ✅ official TikTok Shop API (PR009) |
 * | `InstagramConnector` | `INSTAGRAM` | 🧩 placeholder ("Not implemented") |
 * | `ShopeeConnector`    | `SHOPEE`    | 🧩 placeholder ("Not implemented") |
 *
 * ```
 * modules/connectors/
 * ├── core/       connector.interface · connector.factory · connector.validator
 * │               · connector.dto · connector.repository · connector.sync
 * ├── mock/       MockConnector (deterministic dataset)
 * ├── tiktok/     official OAuth · API · importer · webhook connector (PR009)
 * ├── instagram/  InstagramConnector (placeholder)
 * └── shopee/     ShopeeConnector (placeholder)
 * ```
 */

export * from "./core";
export { MockConnector } from "./mock";
export { TikTokConnector } from "./tiktok";
export { InstagramConnector } from "./instagram";
export { ShopeeConnector } from "./shopee";
