/**
 * DTOs — the shapes the campaigns module exposes to the UI layer
 * (PR005.1 — Product Match Architecture).
 *
 * Server components receive these objects and may pass them to client
 * components; they never contain secret material or cross-tenant data.
 * Dates are ISO strings so everything survives the RSC serialization
 * boundary.
 */

import type { Prisma } from "@prisma/client";
import {
  MATCH_SOURCE_LABELS,
  type MatchSourceName,
  type MatchStatusName,
  matchStatusFromSource,
} from "../matching/match-source";
import type { CreateProductMatchInput } from "../validators/product-match.validator";

// ------------------------------------------------------------------
// Persistence payload
// ------------------------------------------------------------------

/**
 * The validated payload persisted as one `ProductMatch` row — the four
 * data columns of the model. `organizationId` is injected server-side
 * from the session, never carried by the DTO.
 */
export type CreateProductMatchDTO = {
  externalContentId: string;
  productId: string;
  /** Float in [0, 1], rounded to 2 decimals. */
  confidence: number;
  matchedBy: MatchSourceName;
};

export type { CreateProductMatchInput };

/** A `ProductMatch` row with its two endpoints loaded (dashboard shape). */
export type ProductMatchRow = Prisma.ProductMatchGetPayload<{
  include: { externalContent: true; product: true };
}>;

// ------------------------------------------------------------------
// RSC-serializable shapes
// ------------------------------------------------------------------

/** Row shape consumed by the dashboard matches table. */
export interface ProductMatchItemDTO {
  id: string;
  /** The "Vídeo" column — the imported content being matched. */
  content: {
    id: string;
    title: string;
    externalId: string;
    platform: string;
    type: string;
    url: string | null;
  };
  /** The "Produto" column — the internal product being sold. */
  product: {
    id: string;
    name: string;
    slug: string;
  };
  /** Float in [0, 1] — displayed as e.g. "0.85". */
  confidence: number;
  /** Origem: AI · MANUAL · RULE. */
  matchedBy: MatchSourceName;
  /** Derived: MANUAL → APROVADO · AI/RULE → PENDENTE. */
  status: MatchStatusName;
  createdAt: string;
}

export function toProductMatchItemDTO(row: ProductMatchRow): ProductMatchItemDTO {
  return {
    id: row.id,
    content: {
      id: row.externalContent.id,
      title: row.externalContent.title,
      externalId: row.externalContent.externalId,
      platform: row.externalContent.platform,
      type: row.externalContent.type,
      url: row.externalContent.url,
    },
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.slug,
    },
    confidence: row.confidence,
    matchedBy: row.matchedBy,
    status: matchStatusFromSource(row.matchedBy),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Paginated result envelope for the dashboard table. */
export interface ProductMatchPageDTO {
  items: ProductMatchItemDTO[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function toProductMatchPageDTO(
  items: ProductMatchItemDTO[],
  page: number,
  pageSize: number,
  total: number,
): ProductMatchPageDTO {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

// ------------------------------------------------------------------
// KPIs
// ------------------------------------------------------------------

/** Raw KPI aggregates produced by the repository. */
export interface ProductMatchKpis {
  /** Imported external content rows in the tenant. */
  importedContents: number;
  totalMatches: number;
  /** Matches produced automatically (matchedBy AI or RULE). */
  automaticMatches: number;
  /** Matches created/approved by a human (matchedBy MANUAL). */
  manualMatches: number;
  /** Distinct contents that already have at least one match. */
  matchedContents: number;
  /** Average confidence across every match (0 when there are none). */
  averageConfidence: number;
}

/** KPI aggregates for the dashboard header. */
export interface ProductMatchKpisDTO {
  /** "Conteúdos importados". */
  importedContents: number;
  /** "Matches automáticos" — AI + RULE. */
  automaticMatches: number;
  /** "Pendentes" — imported contents still without any match. */
  pendingContents: number;
  /** "Confiança média" — e.g. 0.72. */
  averageConfidence: number;
  /** Total matches (context for the table header). */
  totalMatches: number;
  /** Manual (approved) matches. */
  manualMatches: number;
}

export function toProductMatchKpisDTO(kpis: ProductMatchKpis): ProductMatchKpisDTO {
  return {
    importedContents: kpis.importedContents,
    automaticMatches: kpis.automaticMatches,
    // A content is "pending" while it has no match at all — the backlog the
    // matcher (or a human curator) still has to cover.
    pendingContents: Math.max(0, kpis.importedContents - kpis.matchedContents),
    averageConfidence: Math.round(kpis.averageConfidence * 100) / 100,
    totalMatches: kpis.totalMatches,
    manualMatches: kpis.manualMatches,
  };
}

// ------------------------------------------------------------------
// Server-action result
// ------------------------------------------------------------------

/** Uniform result for server actions (success or field/form errors). */
export type MatchActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** pt-BR label of a match origin (dashboard helper). */
export function matchSourceLabel(matchedBy: MatchSourceName): string {
  return MATCH_SOURCE_LABELS[matchedBy];
}
