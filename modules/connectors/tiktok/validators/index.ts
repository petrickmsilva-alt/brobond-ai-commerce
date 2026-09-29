import { z } from "zod";

/** OAuth callback fields are deliberately small and never carry a tenant id. */
export const tiktokOAuthCallbackSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  state: z.string().trim().min(32).max(512),
});

export const tiktokDisconnectSchema = z.object({
  accountId: z.string().trim().min(1).max(128),
});

export const tiktokWebhookPayloadSchema = z
  .object({
    tts_notification_id: z.string().trim().min(1).max(256).optional(),
    notification_id: z.string().trim().min(1).max(256).optional(),
    shop_id: z.union([z.string(), z.number()]).optional(),
    type: z.union([z.string(), z.number()]).optional(),
    event_type: z.string().trim().max(120).optional(),
    data: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type TikTokOAuthCallbackInput = z.infer<typeof tiktokOAuthCallbackSchema>;
