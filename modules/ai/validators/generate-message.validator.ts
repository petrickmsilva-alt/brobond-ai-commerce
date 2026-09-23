import { z } from "zod";
import { AI_MESSAGE_TONES } from "../openai/prompts";

/** Input schema for the `/dashboard/ai` "generate message" server action. */
export const generateAiMessageSchema = z.object({
  creatorId: z.string().trim().min(1, "Selecione um criador."),
  productId: z.string().trim().min(1, "Selecione um produto."),
  campaignId: z.string().trim().min(1, "Selecione uma campanha."),
  tone: z.enum(AI_MESSAGE_TONES),
});

export type GenerateAiMessageDTO = z.infer<typeof generateAiMessageSchema>;

export const aiMessageListSchema = z.object({
  tone: z.enum(AI_MESSAGE_TONES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
