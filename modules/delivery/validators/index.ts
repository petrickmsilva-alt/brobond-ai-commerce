import { z } from "zod";
import {
  DELIVERY_CHANNELS,
  DELIVERY_STATUSES,
  type CommerceExecutionDeliveryRequest,
} from "../core/delivery.interface";

/**
 * Delivery validators (PR010) — the single zod boundary for EVERY input
 * that enters the delivery engine: server actions, webhook-adjacent query
 * params and the CommerceExecution intake contract.
 */

export const deliveryChannelSchema = z.enum(DELIVERY_CHANNELS);
export const deliveryStatusSchema = z.enum(DELIVERY_STATUSES);

// ------------------------------------------------------------------
// Outbound message bodies
// ------------------------------------------------------------------

const textMessageSchema = z.object({
  type: z.literal("text"),
  text: z.string().trim().min(1, "A mensagem não pode ser vazia.").max(4096),
});

const templateComponentSchema: z.ZodType<
  import("../core/delivery.interface").WhatsAppTemplateComponent
> = z.object({
  type: z.enum(["header", "body", "button"]),
  sub_type: z.string().max(64).optional(),
  index: z.string().max(8).optional(),
  parameters: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("text"), text: z.string().min(1).max(1024) }),
        z.object({
          type: z.literal("currency"),
          currency: z.object({
            fallback_value: z.string().min(1).max(64),
            code: z.string().length(3),
            amount_1000: z.number().int().nonnegative(),
          }),
        }),
        z.object({
          type: z.literal("date_time"),
          date_time: z.object({ fallback_value: z.string().min(1).max(64) }),
        }),
      ]),
    )
    .min(1)
    .max(20),
});

const templateMessageSchema = z.object({
  type: z.literal("template"),
  templateName: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9_]+$/, "Nome de template inválido (minúsculas, números e _)."),
  language: z
    .string()
    .trim()
    .min(2)
    .max(16)
    .regex(/^[a-z]{2}([_-][A-Za-z]{2})?$/, "Código de idioma inválido."),
  components: z.array(templateComponentSchema).max(10).optional(),
});

export const outboundMessageSchema = z.discriminatedUnion("type", [
  textMessageSchema,
  templateMessageSchema,
]);

// ------------------------------------------------------------------
// CommerceExecution intake (dispatcher contract)
// ------------------------------------------------------------------

export const commerceExecutionDeliverySchema: z.ZodType<CommerceExecutionDeliveryRequest> =
  z.object({
    organizationId: z.string().trim().min(1),
    executionId: z.string().trim().min(1).max(128),
    status: z.string().trim().min(1).max(32),
    channel: deliveryChannelSchema,
    recipientId: z.string().trim().min(1).max(128),
    recipientName: z.string().trim().max(160).nullish(),
    campaignId: z.string().trim().max(64).nullish(),
    campaignName: z.string().trim().max(160).nullish(),
    creatorId: z.string().trim().max(64).nullish(),
    creatorName: z.string().trim().max(160).nullish(),
    message: outboundMessageSchema,
  });

// ------------------------------------------------------------------
// Server action inputs
// ------------------------------------------------------------------

/** Manual send (MANAGER+): queue + dispatch to one recipient. */
export const sendDeliverySchema = z.object({
  channel: deliveryChannelSchema,
  recipientId: z.string().trim().min(1, "Destinatário é obrigatório.").max(128),
  recipientName: z.string().trim().max(160).optional(),
  campaignId: z.string().trim().max(64).optional(),
  campaignName: z.string().trim().max(160).optional(),
  message: outboundMessageSchema,
});

export const disconnectDeliveryAccountSchema = z.object({
  accountPk: z.string().trim().min(1),
});

export const deliveryMessageIdSchema = z.object({
  messageId: z.string().trim().min(1),
});

export const deliveryOAuthCallbackSchema = z.object({
  code: z.string().trim().min(1).max(2048),
  state: z.string().trim().min(1).max(512),
});

// ------------------------------------------------------------------
// Dashboard filters
// ------------------------------------------------------------------

export const deliveryFiltersSchema = z.object({
  channel: z
    .string()
    .optional()
    .transform((value) =>
      value && deliveryChannelSchema.safeParse(value).success ? value : undefined,
    )
    .pipe(deliveryChannelSchema.optional()),
  status: z
    .string()
    .optional()
    .transform((value) =>
      value && deliveryStatusSchema.safeParse(value).success ? value : undefined,
    )
    .pipe(deliveryStatusSchema.optional()),
  campaignId: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => (value ? value : undefined)),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DeliveryFiltersInput = z.infer<typeof deliveryFiltersSchema>;
