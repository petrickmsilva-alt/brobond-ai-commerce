import { OutreachStatus, TemplateType } from "@prisma/client";
import { z } from "zod";
import { createMessageSchema } from "../dto/create-message.dto";
import { unresolvedVariables } from "../prompts/variables";

export const ALLOWED_TEMPLATE_VARIABLES = [
  "creatorName",
  "niche",
  "productName",
  "campaignName",
  "trendKeyword",
] as const;

export const messageTemplateSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    type: z.nativeEnum(TemplateType),
    content: z.string().trim().min(10).max(5_000),
  })
  .superRefine((template, ctx) => {
    const invalid = unresolvedVariables(template.content).filter(
      (key) => !(ALLOWED_TEMPLATE_VARIABLES as readonly string[]).includes(key),
    );
    if (invalid.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: `Variáveis não permitidas: ${[...new Set(invalid)].join(", ")}`,
      });
    }
  });

export const updateMessageSchema = z.object({
  id: z.string().trim().min(1),
  generatedText: z.string().trim().min(1).max(5_000),
});

export const scheduleMessageSchema = z.object({
  id: z.string().trim().min(1),
  scheduledFor: z.coerce.date().refine((date) => date.getTime() > Date.now(), {
    message: "O agendamento deve estar no futuro.",
  }),
});

export const outreachListSchema = z.object({
  status: z.nativeEnum(OutreachStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export { createMessageSchema };
