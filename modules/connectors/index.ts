/**
 * Connector Framework — shared contracts plus production adapters for
 * TikTok Shop, Instagram Shopping, Shopee, Nuvemshop, Mercado Livre and
 * Mercado Pago. `MockConnector` remains isolated to deterministic framework
 * tests/development and is never a fallback for a real provider.
 */

export * from "./core";
export { MockConnector } from "./mock";
export { TikTokConnector } from "./tiktok";
export { InstagramConnector } from "./instagram";
export { ShopeeConnector } from "./shopee";
export { NuvemshopConnector } from "./nuvemshop";
