import { z } from "zod";

export const executiveRecommendationSchema = z
  .object({
    opportunityKey: z.string().trim().min(1).max(240),
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().min(1).max(2_000),
    reason: z.string().trim().min(1).max(2_000),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const executiveStrategyResponseSchema = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    decisions: z.array(executiveRecommendationSchema).max(20),
  })
  .strict();

export const executiveReportResponseSchema = z
  .object({
    summary: z.string().trim().min(1).max(8_000),
    risks: z.array(z.string().trim().min(1).max(1_000)).max(10),
    opportunities: z.array(z.string().trim().min(1).max(1_000)).max(10),
  })
  .strict();

export const decisionIdSchema = z.object({
  decisionId: z.string().trim().min(1).max(128),
});

export const decisionTransitionSchema = decisionIdSchema.extend({
  status: z.enum(["APPROVED", "REJECTED", "EXECUTED"]),
});

export type DecisionTransitionInput = z.infer<typeof decisionTransitionSchema>;
