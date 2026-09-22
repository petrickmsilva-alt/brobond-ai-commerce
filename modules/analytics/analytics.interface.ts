/**
 * Analytics module — INTERFACE ONLY (reserved for PR006).
 *
 * PR000 deliberately does NOT implement any analytics pipeline, tracking,
 * or reporting engine. This file defines the contract only.
 */

export interface AnalyticsMetric {
  key: string;
  label: string;
  value: number;
  unit?: string;
}

export interface AnalyticsProvider {
  /** Track an arbitrary event. NOT IMPLEMENTED in PR000. */
  track(event: string, properties?: Record<string, unknown>): Promise<void>;
  /** Retrieve a set of metrics for a time range. NOT IMPLEMENTED in PR000. */
  getMetrics(range: { from: Date; to: Date }): Promise<AnalyticsMetric[]>;
}

const NOT_IMPLEMENTED = "Analytics pipeline is not implemented in PR000 (reserved for PR006).";

export function createAnalyticsProvider(): AnalyticsProvider {
  return {
    track() {
      throw new Error(NOT_IMPLEMENTED);
    },
    getMetrics() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
