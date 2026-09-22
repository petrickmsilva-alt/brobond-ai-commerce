import type {
  CreatorMetric,
  CreatorProfile,
  CreatorSource,
  CreatorStatus,
  CreatorTag,
} from "@prisma/client";
import type { CreatorStatusName, ScoredCreator } from "../../interfaces/creator.interface";
import { CREATOR_STATUS_LABELS } from "../../interfaces/creator.interface";
import type { CreateCreatorInput } from "../validators/creator.validator";

/**
 * DTOs — the shapes the creators module exposes to the UI layer.
 *
 * Server components receive these objects and may pass them to client
 * components; they never contain secret material or cross-tenant data.
 * Dates are ISO strings so everything survives the RSC serialization
 * boundary.
 */

// ------------------------------------------------------------------
// Persistence payloads
// ------------------------------------------------------------------

/** Payload persisted as one `CreatorProfile` row (manual CRM creation). */
export interface CreateCreatorDTO {
  handle: string;
  displayName: string;
  niche: string;
  followers: number;
  avgViews: number;
  engagementRate: number;
  creatorScore: number;
  bio?: string;
  email?: string;
  avatarUrl?: string;
  status: CreatorStatus;
  source: CreatorSource;
}

/**
 * Map a validated manual-creation input to its persistence payload.
 * `source` is always MANUAL and `status` always NEW — a form may never
 * mint a discovered/qualified profile. The score is computed server-side
 * from the metrics the operator supplied (unknown components score 0;
 * the niche is a deliberate human choice, so it matches in full).
 */
export function toCreateCreatorDTO(
  input: CreateCreatorInput,
  creatorScore: number,
): CreateCreatorDTO {
  return {
    handle: input.handle,
    displayName: input.displayName,
    niche: input.niche,
    followers: input.followers ?? 0,
    avgViews: input.avgViews ?? 0,
    engagementRate: input.engagementRate ?? 0,
    creatorScore,
    bio: input.bio,
    email: input.email,
    avatarUrl: input.avatarUrl,
    status: "NEW" as CreatorStatus,
    source: "MANUAL" as CreatorSource,
  };
}

/** Payload upserted by the discovery pipeline (dedupe: source+externalId). */
export interface DiscoveryUpsertDTO {
  externalId: string;
  handle: string;
  displayName: string;
  niche: string;
  followers: number;
  avgViews: number;
  engagementRate: number;
  creatorScore: number;
  status: CreatorStatus;
  source: CreatorSource;
}

/**
 * Map a scored candidate to its discovery upsert payload. The pipeline
 * never overrides the CRM status on re-import — a profile a manager moved
 * to NEGOTIATING stays there; only the metrics and the score refresh.
 */
export function toDiscoveryUpsertDTO(
  scored: ScoredCreator,
  source: CreatorSource,
): DiscoveryUpsertDTO {
  return {
    externalId: scored.externalId,
    handle: scored.handle,
    displayName: scored.displayName,
    niche: scored.niche,
    followers: scored.followers,
    avgViews: scored.avgViews,
    engagementRate: scored.engagementRate,
    creatorScore: scored.creatorScore,
    status: "NEW" as CreatorStatus,
    source,
  };
}

/** Today's metric snapshot derived from a scored candidate. */
export interface DerivedCreatorMetricDTO {
  date: Date;
  views: number;
  likes: number;
  shares: number;
  followers: number;
}

/**
 * Derive a daily metric snapshot from a candidate: views mirror `avgViews`,
 * likes are the engagement-rate share of them and shares a fixed slice of
 * the likes (mock-grade derivation — a real source reports real numbers).
 */
export function deriveDailyMetric(scored: ScoredCreator, date: Date): DerivedCreatorMetricDTO {
  const likes = Math.round(scored.avgViews * (scored.engagementRate / 100));
  return {
    date,
    views: scored.avgViews,
    likes,
    shares: Math.round(likes * 0.1),
    followers: scored.followers,
  };
}

// ------------------------------------------------------------------
// Dashboard read models
// ------------------------------------------------------------------

/** Row shape consumed by the dashboard creators table / Kanban cards. */
export interface CreatorListItemDTO {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  niche: string;
  followers: number;
  avgViews: number;
  engagementRate: number;
  creatorScore: number;
  status: CreatorStatus;
  source: CreatorSource;
  createdAt: string; // ISO — serializable across the RSC boundary
  updatedAt: string;
}

/** Paginated result envelope for the dashboard table. */
export interface CreatorPageDTO {
  items: CreatorListItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** KPI aggregates for the dashboard header. */
export interface CreatorStatsDTO {
  totalCreators: number;
  averageScore: number | null;
  premiumCount: number;
  contactedCount: number;
  statusCounts: Record<CreatorStatusName, number>;
}

/** One Kanban column of the CRM pipeline. */
export interface CreatorPipelineColumnDTO {
  status: CreatorStatusName;
  label: string;
  count: number;
  items: CreatorListItemDTO[];
}

export function toCreatorListItemDTO(creator: CreatorProfile): CreatorListItemDTO {
  return {
    id: creator.id,
    handle: creator.handle,
    displayName: creator.displayName,
    avatarUrl: creator.avatarUrl ?? null,
    niche: creator.niche,
    followers: creator.followers,
    avgViews: creator.avgViews,
    engagementRate: creator.engagementRate,
    creatorScore: creator.creatorScore,
    status: creator.status,
    source: creator.source,
    createdAt: creator.createdAt.toISOString(),
    updatedAt: creator.updatedAt.toISOString(),
  };
}

export function toCreatorPageDTO(
  items: CreatorProfile[],
  page: number,
  pageSize: number,
  total: number,
): CreatorPageDTO {
  return {
    items: items.map(toCreatorListItemDTO),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function toCreatorStatsDTO(stats: {
  totalCreators: number;
  averageScore: number | null;
  premiumCount: number;
  contactedCount: number;
  statusCounts: Record<CreatorStatusName, number>;
}): CreatorStatsDTO {
  return { ...stats };
}

/**
 * Group tenant-scoped profiles into the six pipeline columns (funnel
 * order). `count` reflects the TOTAL rows in each status — the column may
 * display fewer cards (`limitPerColumn`).
 */
export function toCreatorPipelineDTO(
  columns: readonly { status: CreatorStatusName; count: number; items: CreatorProfile[] }[],
): CreatorPipelineColumnDTO[] {
  return columns.map((column) => ({
    status: column.status,
    label: CREATOR_STATUS_LABELS[column.status],
    count: column.count,
    items: column.items.map(toCreatorListItemDTO),
  }));
}

/** Row shape of a creator tag (detail views / future UI). */
export interface CreatorTagDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export function toCreatorTagDTO(tag: CreatorTag): CreatorTagDTO {
  return {
    id: tag.id,
    name: tag.name,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}

/** Row shape of a daily metric snapshot. */
export interface CreatorMetricItemDTO {
  id: string;
  date: string;
  views: number;
  likes: number;
  shares: number;
  followers: number;
}

export function toCreatorMetricDTO(metric: CreatorMetric): CreatorMetricItemDTO {
  return {
    id: metric.id,
    date: metric.date.toISOString(),
    views: metric.views,
    likes: metric.likes,
    shares: metric.shares,
    followers: metric.followers,
  };
}

/** Uniform result for server actions (success or field/form errors). */
export type CreatorActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
