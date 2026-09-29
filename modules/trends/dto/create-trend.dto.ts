import type { TrendCategory, TrendKeyword, TrendSnapshot, TrendSource } from "@prisma/client";
import type { TrendSignal } from "../interfaces/trend.interface";
import { DEFAULT_TREND_SOURCE } from "../interfaces/trend.interface";
import { calculateTrendScore } from "../hunter/scorer";

/**
 * DTOs — the shapes the trends module exposes to the UI layer.
 *
 * Server components receive these objects and may pass them to client
 * components; they never contain secret material or cross-tenant data.
 * Dates are ISO strings so everything survives the RSC serialization
 * boundary.
 */

/** Payload persisted as one `TrendSnapshot` row. */
export interface CreateTrendDTO {
  keyword: string;
  category: string;
  views: number;
  likes: number;
  shares: number;
  trendScore: number;
  /**
   * Origin of the snapshot (PR002.1). Optional for retrocompatibility —
   * when omitted the database default (`MOCK`) applies.
   */
  source?: TrendSource;
}

/**
 * Map a raw signal to its persistence payload, scoring it with the score
 * engine unless an explicit score is supplied (the scheduler passes the
 * already-computed score; the score is NEVER trusted from a client).
 *
 * `source` (PR002.1) records where the signal came from — it defaults to
 * `MOCK` so pre-PR002.1 callers behave exactly as before.
 */
export function toCreateTrendDTO(
  signal: TrendSignal,
  trendScore?: number,
  source: TrendSource = DEFAULT_TREND_SOURCE,
): CreateTrendDTO {
  return {
    keyword: signal.keyword,
    category: signal.category,
    views: signal.views,
    likes: signal.likes,
    shares: signal.shares,
    trendScore: trendScore ?? calculateTrendScore(signal),
    source,
  };
}

/** Row shape consumed by the dashboard trends table. */
export interface TrendSnapshotItemDTO {
  id: string;
  keyword: string;
  category: string;
  views: number;
  likes: number;
  shares: number;
  trendScore: number;
  /** Origin of the snapshot (PR002.1) — powers the "Origem" filter. */
  source: TrendSource;
  createdAt: string; // ISO — serializable across the RSC boundary
  updatedAt: string;
}

/** Paginated result envelope for the dashboard table. */
export interface TrendPageDTO {
  items: TrendSnapshotItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Row shape of the aggregated keyword ranking. */
export interface TrendKeywordDTO {
  id: string;
  keyword: string;
  frequency: number;
  createdAt: string;
  updatedAt: string;
}

/** Row shape of a materialized category. */
export interface TrendCategoryDTO {
  id: string;
  name: string;
  score: number;
  createdAt: string;
  updatedAt: string;
}

/** KPI aggregates for the dashboard header. */
export interface TrendStatsDTO {
  totalSnapshots: number;
  maxScore: number | null;
  keywordCount: number;
  categoryCount: number;
  lastCollectedAt: string | null;
}

export function toTrendSnapshotDTO(snapshot: TrendSnapshot): TrendSnapshotItemDTO {
  return {
    id: snapshot.id,
    keyword: snapshot.keyword,
    category: snapshot.category,
    views: snapshot.views,
    likes: snapshot.likes,
    shares: snapshot.shares,
    trendScore: snapshot.trendScore,
    source: snapshot.source,
    createdAt: snapshot.createdAt.toISOString(),
    updatedAt: snapshot.updatedAt.toISOString(),
  };
}

export function toTrendKeywordDTO(keyword: TrendKeyword): TrendKeywordDTO {
  return {
    id: keyword.id,
    keyword: keyword.keyword,
    frequency: keyword.frequency,
    createdAt: keyword.createdAt.toISOString(),
    updatedAt: keyword.updatedAt.toISOString(),
  };
}

export function toTrendCategoryDTO(category: TrendCategory): TrendCategoryDTO {
  return {
    id: category.id,
    name: category.name,
    score: category.score,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  };
}

export function toTrendStatsDTO(stats: {
  totalSnapshots: number;
  maxScore: number | null;
  keywordCount: number;
  categoryCount: number;
  lastCollectedAt: Date | null;
}): TrendStatsDTO {
  return {
    totalSnapshots: stats.totalSnapshots,
    maxScore: stats.maxScore,
    keywordCount: stats.keywordCount,
    categoryCount: stats.categoryCount,
    lastCollectedAt: stats.lastCollectedAt ? stats.lastCollectedAt.toISOString() : null,
  };
}

/** Uniform result for server actions (success or field/form errors). */
export type TrendActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
