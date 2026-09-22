/**
 * Zod validation — single source of truth for every product-match write
 * path (server actions, future API routes).
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session (`requireOrganization()`), never
 * accepted from the client. A client-supplied `confidence` is validated
 * against the 0–1 range but production flows always compute it with the
 * score engine.
 */

import { z } from "zod";
import { MATCH_SOURCES } from "../matching/match-source";

/** Rounds a float to two decimal places (stable persisted value). */
function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const matchSourceSchema = z.enum(MATCH_SOURCES, {
  errorMap: () => ({ message: `Origem inválida. Use: ${MATCH_SOURCES.join(", ")}.` }),
});

const cuidSchema = z
  .string({ invalid_type_error: "Informe o id." })
  .trim()
  .min(1, "O id é obrigatório.")
  .max(64, "Id acima do limite suportado.");

/** Confidence: a finite float between 0 and 1, rounded to 2 decimals. */
export const matchConfidenceSchema = z
  .number({ invalid_type_error: "Informe a confiança." })
  .min(0, "A confiança mínima é 0.")
  .max(1, "A confiança máxima é 1.")
  .refine((value) => Number.isFinite(value), "A confiança deve ser um número finito.")
  .transform(roundTo2);

/**
 * Payload persisted as one `ProductMatch` row.
 *
 * The four data columns exactly — `organizationId` is injected by the
 * repository from the session, never accepted from the client.
 */
export const createProductMatchSchema = z.object({
  externalContentId: cuidSchema,
  productId: cuidSchema,
  confidence: matchConfidenceSchema,
  matchedBy: matchSourceSchema,
});

export type CreateProductMatchInput = z.input<typeof createProductMatchSchema>;

/** Payload accepted by `approveMatch()` — the match to promote to MANUAL. */
export const approveProductMatchSchema = z.object({
  matchId: cuidSchema,
});

export type ApproveProductMatchInput = z.input<typeof approveProductMatchSchema>;

/** Payload accepted by `removeMatch()` — the match to delete. */
export const removeProductMatchSchema = z.object({
  matchId: cuidSchema,
});

export type RemoveProductMatchInput = z.input<typeof removeProductMatchSchema>;

// ------------------------------------------------------------------
// Dashboard list query (pagination + search)
// ------------------------------------------------------------------

export const MATCH_PAGE_SIZE_DEFAULT = 10;
export const MATCH_PAGE_SIZE_MAX = 50;

/**
 * URL-state of the dashboard matches table. Every field is optional and
 * every invalid value falls back to a safe default — a malformed URL must
 * never produce a 500.
 */
export const matchListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, "Busca acima do limite.")
    .optional()
    .transform((value) => (value ? value : undefined)),
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MATCH_PAGE_SIZE_MAX)
    .catch(MATCH_PAGE_SIZE_DEFAULT)
    .default(MATCH_PAGE_SIZE_DEFAULT),
});

export type MatchListQuery = z.output<typeof matchListQuerySchema>;
