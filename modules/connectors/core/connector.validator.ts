/**
 * Zod validation — single source of truth for every connector write path
 * (server actions, sync ingestion, future API routes).
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session (`requireOrganization()`), never
 * accepted from the client.
 */

import { z } from "zod";
import {
  CONNECTOR_PLATFORMS,
  CONNECTOR_STATES,
  EXTERNAL_CONTENT_STATUSES,
  EXTERNAL_CONTENT_TYPES,
} from "./connector.interface";

export const connectorPlatformSchema = z.enum(CONNECTOR_PLATFORMS, {
  errorMap: () => ({ message: `Plataforma inválida. Use: ${CONNECTOR_PLATFORMS.join(", ")}.` }),
});

export const connectorStateSchema = z.enum(CONNECTOR_STATES, {
  errorMap: () => ({ message: `Estado inválido. Use: ${CONNECTOR_STATES.join(", ")}.` }),
});

export const externalContentTypeSchema = z.enum(EXTERNAL_CONTENT_TYPES, {
  errorMap: () => ({ message: `Tipo inválido. Use: ${EXTERNAL_CONTENT_TYPES.join(", ")}.` }),
});

export const externalContentStatusSchema = z.enum(EXTERNAL_CONTENT_STATUSES, {
  errorMap: () => ({ message: `Status inválido. Use: ${EXTERNAL_CONTENT_STATUSES.join(", ")}.` }),
});

const engagementCountSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .int("Use um número inteiro.")
  .min(0, "O valor não pode ser negativo.")
  .max(10_000_000_000, "Valor acima do limite suportado.");

/**
 * Canonical form of an external id: trimmed, inner whitespace collapsed.
 * This is the form persisted in `ExternalContent.externalId`, so
 * " mock-video-001 " and "mock-video-001" land on the same dedupe identity.
 */
export function normalizeExternalId(externalId: string): string {
  return externalId.trim().replace(/\s+/g, " ");
}

const externalIdSchema = z
  .string({ invalid_type_error: "Informe o externalId." })
  .transform((value) => normalizeExternalId(value))
  .refine((value) => value.length >= 1, "O externalId é obrigatório.")
  .refine((value) => value.length <= 180, "O externalId deve ter no máximo 180 caracteres.");

const optionalUrlSchema = z
  .string()
  .trim()
  .url("Informe uma URL válida.")
  .max(2000, "URL acima do limite suportado.")
  .optional();

/**
 * One normalized item as produced by a connector — validated BEFORE any
 * database write, so a misbehaving adapter can never poison the tenant's
 * content table.
 */
export const normalizedContentSchema = z.object({
  externalId: externalIdSchema,
  type: externalContentTypeSchema,
  title: z
    .string({ invalid_type_error: "Informe o título." })
    .trim()
    .min(1, "O título é obrigatório.")
    .max(300, "O título deve ter no máximo 300 caracteres."),
  url: optionalUrlSchema,
  thumbnailUrl: optionalUrlSchema,
  authorHandle: z.string().trim().max(120, "Handle acima do limite.").optional(),
  caption: z.string().trim().max(2000, "Legenda acima do limite.").optional(),
  views: engagementCountSchema.default(0),
  likes: engagementCountSchema.default(0),
  shares: engagementCountSchema.default(0),
  publishedAt: z.date().optional(),
  raw: z.record(z.unknown()).optional(),
});

export type NormalizedContentInput = z.input<typeof normalizedContentSchema>;

// ------------------------------------------------------------------
// Sync input (server action → sync service)
// ------------------------------------------------------------------

export const SYNC_LIMIT_DEFAULT = 50;
export const SYNC_LIMIT_MAX = 200;

/** Payload accepted by the "Sincronizar" action — platform + optional cap. */
export const syncConnectorSchema = z.object({
  platform: connectorPlatformSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1, "O limite mínimo é 1.")
    .max(SYNC_LIMIT_MAX, `O limite máximo é ${SYNC_LIMIT_MAX}.`)
    .default(SYNC_LIMIT_DEFAULT),
});

export type SyncConnectorInput = z.input<typeof syncConnectorSchema>;

/** Payload accepted by the enable/disable toggle (ADMIN only). */
export const toggleConnectorSchema = z.object({
  platform: connectorPlatformSchema,
  enabled: z.boolean({ invalid_type_error: "Informe um booleano." }),
});

export type ToggleConnectorInput = z.input<typeof toggleConnectorSchema>;

// ------------------------------------------------------------------
// Dashboard list query (pagination + filters)
// ------------------------------------------------------------------

export const CONTENT_PAGE_SIZE_DEFAULT = 10;
export const CONTENT_PAGE_SIZE_MAX = 50;

export const contentSortFields = ["createdAt", "publishedAt", "views", "likes", "title"] as const;
export type ContentSortField = (typeof contentSortFields)[number];

/**
 * URL-state of the dashboard content table. Every field is optional and
 * every invalid value falls back to a safe default — a malformed URL must
 * never produce a 500.
 */
export const contentListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => (value ? value : undefined)),
  platform: z
    .string()
    .optional()
    .transform((value) =>
      value && connectorPlatformSchema.safeParse(value).success ? value : undefined,
    )
    .pipe(connectorPlatformSchema.optional()),
  status: z
    .string()
    .optional()
    .transform((value) =>
      value && externalContentStatusSchema.safeParse(value).success ? value : undefined,
    )
    .pipe(externalContentStatusSchema.optional()),
  type: z
    .string()
    .optional()
    .transform((value) =>
      value && externalContentTypeSchema.safeParse(value).success ? value : undefined,
    )
    .pipe(externalContentTypeSchema.optional()),
  sort: z
    .string()
    .optional()
    .transform((value) =>
      (contentSortFields as readonly string[]).includes(value ?? "")
        ? (value as ContentSortField)
        : ("createdAt" as ContentSortField),
    ),
  order: z
    .string()
    .optional()
    .transform((value) => (value === "asc" ? ("asc" as const) : ("desc" as const))),
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(CONTENT_PAGE_SIZE_MAX)
    .catch(CONTENT_PAGE_SIZE_DEFAULT)
    .default(CONTENT_PAGE_SIZE_DEFAULT),
});

export type ContentListQuery = z.output<typeof contentListQuerySchema>;
