/**
 * Creator Discovery Engine (PR003).
 *
 * collectors/ · collector.factory · scorer · scheduler — the pipeline that
 * finds creators (MOCK source today; TikTok, Instagram and Shopee behind
 * the same factory in future PRs), scores them 0–100 and upserts them
 * into the CRM.
 */
export * from "./collector.factory";
export * from "./scorer";
export * from "./scheduler";
