import type { OutreachMessage } from "@prisma/client";
import { z } from "zod";

export const createMessageSchema = z.object({
  creatorId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  campaignId: z.string().trim().min(1),
  templateId: z.string().trim().min(1),
  generatedText: z.string().trim().min(1).max(5_000),
  createdById: z.string().trim().min(1).optional(),
});

export type CreateMessageDTO = z.infer<typeof createMessageSchema>;

export interface OutreachMessageDTO {
  id: string;
  status: OutreachMessage["status"];
  generatedText: string;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toOutreachMessageDTO(message: OutreachMessage): OutreachMessageDTO {
  return {
    id: message.id,
    status: message.status,
    generatedText: message.generatedText,
    scheduledFor: message.scheduledFor?.toISOString() ?? null,
    sentAt: message.sentAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}
