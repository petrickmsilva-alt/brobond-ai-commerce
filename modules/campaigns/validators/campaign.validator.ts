import { z } from "zod";

export const campaignIdSchema = z
  .object({ campaignId: z.string().trim().min(1).max(191) })
  .strict();

export const campaignRuleSchema = z
  .object({
    minimumCreatorScore: z.coerce.number().int().min(0).max(100),
    minimumTrendScore: z.coerce.number().int().min(0).max(100),
    minimumProductMargin: z.coerce.number().int().min(0).max(10_000),
    preferredNiche: z.string().trim().max(80).nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();
