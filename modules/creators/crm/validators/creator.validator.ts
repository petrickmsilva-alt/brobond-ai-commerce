import { z } from "zod";
import {
  CREATOR_NICHES,
  CREATOR_SOURCES,
  CREATOR_STATUSES,
  DEFAULT_CREATOR_SOURCE,
  type CreatorNicheName,
  type CreatorSourceName,
  type CreatorStatusName,
} from "../../interfaces/creator.interface";

/**
 * Zod validation — single source of truth for every creators-module write
 * path (server actions, discovery ingestion, future API routes).
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session (`requireOrganization()`), never
 * accepted from the client.
 */

export { CREATOR_NICHES, CREATOR_SOURCES, CREATOR_STATUSES };
export type { CreatorNicheName, CreatorSourceName, CreatorStatusName };

// ------------------------------------------------------------------
// Shared primitives
// ------------------------------------------------------------------

const countSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .int("Use um número inteiro.")
  .min(0, "O valor não pode ser negativo.")
  .max(10_000_000_000, "Valor acima do limite suportado.");

/** Percents strictly on the 0–100 scale (engagement, quality). */
const percentSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .min(0, "O valor deve estar entre 0 e 100.")
  .max(100, "O valor deve estar entre 0 e 100.");

/** Growth may exceed 100% for small accounts — bound it generously. */
const growthRateSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .min(0, "O valor não pode ser negativo.")
  .max(10_000, "Valor acima do limite suportado.");

export const creatorNicheSchema = z.enum(CREATOR_NICHES, {
  errorMap: () => ({ message: `Nicho inválido. Use: ${CREATOR_NICHES.join(", ")}.` }),
});

export const creatorSourceSchema = z.enum(CREATOR_SOURCES, {
  errorMap: () => ({ message: `Origem inválida. Use: ${CREATOR_SOURCES.join(", ")}.` }),
});

export const creatorStatusSchema = z.enum(CREATOR_STATUSES, {
  errorMap: () => ({ message: `Status inválido. Use: ${CREATOR_STATUSES.join(", ")}.` }),
});

// ------------------------------------------------------------------
// Handle canonicalization
// ------------------------------------------------------------------

/**
 * Canonical form of a handle: trimmed, inner whitespace collapsed,
 * lowercased, guaranteed to carry exactly one leading "@". This is the
 * form persisted in `CreatorProfile.handle`, so "@Ana.Souza", "ana souza"
 * and " @ana.souza " all land on the same CRM identity.
 */
export function normalizeHandle(handle: string): string {
  const collapsed = handle.trim().replace(/\s+/g, " ").toLowerCase().replace(/^@+/, "");
  return collapsed ? `@${collapsed}` : "";
}

const handleSchema = z
  .string({ invalid_type_error: "Informe o handle." })
  .transform((value) => normalizeHandle(value))
  .refine((value) => value.length > 1, "Informe o handle (mínimo 2 caracteres).")
  .refine((value) => value.length <= 80, "O handle deve ter no máximo 80 caracteres.");

// ------------------------------------------------------------------
// Collected candidate (discovery ingestion)
// ------------------------------------------------------------------

export const creatorCandidateSchema = z.object({
  externalId: z
    .string({ invalid_type_error: "Informe o externalId." })
    .trim()
    .min(1, "O externalId é obrigatório.")
    .max(120, "O externalId deve ter no máximo 120 caracteres."),
  handle: handleSchema,
  displayName: z
    .string({ invalid_type_error: "Informe o nome." })
    .trim()
    .min(2, "O nome deve ter no mínimo 2 caracteres.")
    .max(80, "O nome deve ter no máximo 80 caracteres."),
  niche: creatorNicheSchema,
  followers: countSchema,
  avgViews: countSchema,
  engagementRate: percentSchema,
  postsPerWeek: z
    .number({ invalid_type_error: "Informe um número." })
    .min(0, "A frequência não pode ser negativa.")
    .max(70, "Frequência acima do suportado."),
  growthRate: growthRateSchema,
  qualityScore: percentSchema,
  avatarUrl: z.string().url("Informe uma URL válida.").max(500).optional(),
  tags: z
    .array(z.string().trim().min(1).max(40, "Cada tag deve ter no máximo 40 caracteres."))
    .max(10, "Máximo de 10 tags.")
    .optional(),
});

export type CreatorCandidateInput = z.input<typeof creatorCandidateSchema>;

// ------------------------------------------------------------------
// Persisted profile (CRM writes)
// ------------------------------------------------------------------

/** Manual CRM creation — `source` is forced to MANUAL, `status` to NEW. */
export const createCreatorSchema = z.object({
  handle: handleSchema,
  displayName: z
    .string({ invalid_type_error: "Informe o nome." })
    .trim()
    .min(2, "O nome deve ter no mínimo 2 caracteres.")
    .max(80, "O nome deve ter no máximo 80 caracteres."),
  niche: creatorNicheSchema,
  followers: countSchema.default(0),
  avgViews: countSchema.default(0),
  engagementRate: percentSchema.default(0),
  bio: z.string().trim().max(280, "A bio deve ter no máximo 280 caracteres.").optional(),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160).optional(),
  avatarUrl: z.string().url("Informe uma URL válida.").max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10, "Máximo de 10 tags.").optional(),
});

export type CreateCreatorInput = z.input<typeof createCreatorSchema>;

/** Editable subset of a profile (tenant-scoped id comes from the action). */
export const updateCreatorSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  niche: creatorNicheSchema.optional(),
  bio: z.string().trim().max(280).optional(),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160).optional(),
  avatarUrl: z.string().url("Informe uma URL válida.").max(500).optional(),
});

export type UpdateCreatorInput = z.input<typeof updateCreatorSchema>;

/** Pipeline move — `id` + target `status`. */
export const changeCreatorStatusSchema = z.object({
  id: z
    .string({ invalid_type_error: "Informe o id." })
    .trim()
    .min(1, "O id é obrigatório.")
    .max(64),
  status: creatorStatusSchema,
});

export type ChangeCreatorStatusInput = z.input<typeof changeCreatorStatusSchema>;

// ------------------------------------------------------------------
// Dashboard list query (pagination + filters + search + sort)
// ------------------------------------------------------------------

export const CREATOR_PAGE_SIZE_DEFAULT = 10;
export const CREATOR_PAGE_SIZE_MAX = 50;

export const creatorSortFields = [
  "creatorScore",
  "handle",
  "niche",
  "followers",
  "avgViews",
  "engagementRate",
  "createdAt",
] as const;

export const creatorListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(CREATOR_PAGE_SIZE_MAX)
    .catch(CREATOR_PAGE_SIZE_DEFAULT)
    .default(CREATOR_PAGE_SIZE_DEFAULT),
  /** Free-text search over handle / display name. */
  search: z.string().trim().max(160).optional().catch(undefined),
  status: creatorStatusSchema.optional().catch(undefined),
  niche: creatorNicheSchema.optional().catch(undefined),
  source: creatorSourceSchema.optional().catch(undefined),
  sort: z.enum(creatorSortFields).catch("creatorScore").default("creatorScore"),
  order: z.enum(["asc", "desc"]).catch("desc").default("desc"),
});

export type CreatorListQuery = z.output<typeof creatorListQuerySchema>;
export type CreatorListQueryInput = z.input<typeof creatorListQuerySchema>;

export { DEFAULT_CREATOR_SOURCE };
