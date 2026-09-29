/**
 * Trend Collector — PR002 façade (retrocompatible).
 *
 * PR002.1 moved the mock implementation to
 * `modules/trends/hunter/collectors/MockCollector.ts` and source resolution
 * to `modules/trends/hunter/collector.factory.ts`. Everything PR002
 * exported from this module is still exported here, byte-for-byte, so the
 * seed, the tests and any PR002-era importer keep working unchanged.
 *
 * New code should import from the new homes:
 *   - `MOCK_TREND_SIGNALS` / collectors → `hunter/collectors`
 *   - `getCollector` / `getTrendCollector` → `hunter/collector.factory`
 */

export { MOCK_TREND_SIGNALS, MockCollector, MockTrendCollector } from "./collectors/MockCollector";
export { getCollector, getTrendCollector } from "./collector.factory";
