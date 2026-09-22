import { z } from "zod";
import { slugify } from "@/lib/utils";
import {
  DEFAULT_TREND_SOURCE,
  TREND_CATEGORIES,
  TREND_SOURCES,
  type TrendCategoryName,
  type TrendSourceName,
} from "../interfaces/trend.interface";

/**
 * Zod validation — single source of truth for every Trend Hunter write path
 * (server actions, scheduler ingestion, future API routes).
 *
 * `organizationId` is NEVER part of any input schema: the tenant is always
 * resolved server-side from the session (`requireOrganization()`), never
 * accepted from the client.
 */

export { TREND_CATEGORIES, TREND_SOURCES };
export type { TrendCategoryName, TrendSourceName };

const engagementCountSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .int("Use um número inteiro.")
  .min(0, "O valor não pode ser negativo.")
  .max(10_000_000_000, "Valor acima do limite suportado.");

const percentSchema = z
  .number({ invalid_type_error: "Informe um número." })
  .min(0, "O valor deve estar entre 0 e 100.")
  .max(100, "O valor deve estar entre 0 e 100.");

export const trendCategorySchema = z.enum(TREND_CATEGORIES, {
  errorMap: () => ({ message: `Categoria inválida. Use: ${TREND_CATEGORIES.join(", ")}.` }),
});

/** PR002.1 — origin of a trend snapshot (kept in sync with the Prisma enum). */
export const trendSourceSchema = z.enum(TREND_SOURCES, {
  errorMap: () => ({ message: `Origem inválida. Use: ${TREND_SOURCES.join(", ")}.` }),
});

export const keywordSchema = z
  .string()
  .trim()
  .min(2, "A keyword deve ter ao menos 2 caracteres.")
  .max(120, "A keyword deve ter no máximo 120 caracteres.");

// ------------------------------------------------------------------
// Collected signal (input of the pipeline — score computed server-side)
// ------------------------------------------------------------------

/** Raw signal as accepted from a client/admin — the score is NEVER trusted from the client. */
export const trendSignalSchema = z.object({
  keyword: keywordSchema,
  category: trendCategorySchema,
  views: engagementCountSchema.default(0),
  likes: engagementCountSchema.default(0),
  shares: engagementCountSchema.default(0),
  /** Estimated gross margin, percent 0–100. */
  margin: percentSchema.default(0),
  /** Market saturation, percent 0–100. */
  saturation: percentSchema.default(0),
});

export type TrendSignalInput = z.input<typeof trendSignalSchema>;

// ------------------------------------------------------------------
// Persisted snapshot (output of the pipeline)
// ------------------------------------------------------------------

/** Snapshot shape that is actually persisted — the score is always an int 0–100. */
export const createTrendSchema = z.object({
  keyword: keywordSchema,
  category: trendCategorySchema,
  views: engagementCountSchema.default(0),
  likes: engagementCountSchema.default(0),
  shares: engagementCountSchema.default(0),
  trendScore: z
    .number({ invalid_type_error: "Informe um número." })
    .int("O score deve ser um inteiro.")
    .min(0, "O score mínimo é 0.")
    .max(100, "O score máximo é 100.")
    .default(0),
  /** PR002.1 — origin of the snapshot. Defaults to MOCK (retrocompatible). */
  source: trendSourceSchema.default(DEFAULT_TREND_SOURCE),
});

export type CreateTrendInput = z.input<typeof createTrendSchema>;

// ------------------------------------------------------------------
// Dashboard list query (pagination + filters + search + sort)
// ------------------------------------------------------------------

export const TREND_PAGE_SIZE_DEFAULT = 10;
export const TREND_PAGE_SIZE_MAX = 50;

export const trendSortFields = [
  "trendScore",
  "keyword",
  "category",
  "views",
  "likes",
  "createdAt",
] as const;

export const trendListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).catch(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(TREND_PAGE_SIZE_MAX)
    .catch(TREND_PAGE_SIZE_DEFAULT)
    .default(TREND_PAGE_SIZE_DEFAULT),
  /** Free-text search over the keyword. */
  search: z.string().trim().max(160).optional().catch(undefined),
  category: trendCategorySchema.optional().catch(undefined),
  /** PR002.1 — filter by origin ("Origem"). Absent = all sources. */
  source: trendSourceSchema.optional().catch(undefined),
  sort: z.enum(trendSortFields).catch("trendScore").default("trendScore"),
  order: z.enum(["asc", "desc"]).catch("desc").default("desc"),
});

export type TrendListQuery = z.output<typeof trendListQuerySchema>;
export type TrendListQueryInput = z.input<typeof trendListQuerySchema>;

// ------------------------------------------------------------------
// Keyword helpers (slug de keyword)
// ------------------------------------------------------------------

export const KEYWORD_SLUG_MAX_LENGTH = 80;

/** Fallback when a keyword contains no sluggable characters. */
export const KEYWORD_SLUG_FALLBACK = "tendencia";

/**
 * Canonical form of a keyword: trimmed, inner whitespace collapsed,
 * lowercased. This is the form persisted in `TrendSnapshot.keyword` and
 * `TrendKeyword.keyword`, so "Camisa Masculina" and "camisa  masculina"
 * aggregate to the same record.
 */
export function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * URL-safe slug of a keyword: "Camisa Masculina" → "camisa-masculina"
 * (pt-BR accents stripped). Falls back to "tendencia" when there is
 * nothing sluggable, and is capped at `KEYWORD_SLUG_MAX_LENGTH`.
 */
export function keywordSlug(keyword: string): string {
  const slug = slugify(normalizeKeyword(keyword))
    .slice(0, KEYWORD_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
  return slug || KEYWORD_SLUG_FALLBACK;
}
