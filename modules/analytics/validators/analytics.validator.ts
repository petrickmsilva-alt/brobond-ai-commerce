import { z } from "zod";

/**
 * Zod schemas for the Analytics dashboard (PR008).
 * `days` is the only client-influenced parameter — coerced, bounded, and
 * defaulted server-side. No tenant id or metric value is ever accepted
 * from the client.
 */
export const analyticsDaysSchema = z.coerce
  .number()
  .int()
  .min(1, "O período mínimo é 1 dia.")
  .max(365, "O período máximo é 365 dias.")
  .default(30);

export const refreshAnalyticsSchema = z.object({
  days: analyticsDaysSchema,
});

export type RefreshAnalyticsInput = z.infer<typeof refreshAnalyticsSchema>;
