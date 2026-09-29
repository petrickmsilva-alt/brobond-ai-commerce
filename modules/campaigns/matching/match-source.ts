/**
 * Product Matching — client-safe mirrors of the `MatchSource` enum (PR005.1).
 *
 * CLIENT-SAFE on purpose: this file must never import `@prisma/client` as a
 * runtime value (only as a type) — the dashboard imports the source list,
 * the labels and the status derivation to render the matches table.
 *
 * Because Prisma 6 generates `MatchSource` as a string-literal union, the
 * mirror type below is structurally identical to the Prisma enum — values
 * flow across the boundary without casting.
 */

import type { MatchSource } from "@prisma/client";

/**
 * The origins of a product match. Kept in sync with the Prisma `MatchSource`
 * enum (`prisma/schema.prisma`); the sync is pinned by
 * `tests/product-match-dto.test.ts`.
 */
export const MATCH_SOURCES = ["AI", "MANUAL", "RULE"] as const;

export type MatchSourceName = (typeof MATCH_SOURCES)[number];

/** pt-BR display labels for the dashboard "Origem" column. */
export const MATCH_SOURCE_LABELS: Record<MatchSourceName, string> = {
  AI: "IA",
  MANUAL: "Manual",
  RULE: "Regra",
};

/**
 * Which origins are produced automatically (no human involved).
 * The rules engine stamps `RULE`; `AI` is reserved for the future AI
 * provider — no AI call exists in PR005.1, by design.
 */
export const AUTOMATIC_MATCH_SOURCES: readonly MatchSourceName[] = ["AI", "RULE"];

// ------------------------------------------------------------------
// Derived status
// ------------------------------------------------------------------

/** The lifecycle states of a match, derived from `matchedBy`. */
export const MATCH_STATUSES = ["APROVADO", "PENDENTE"] as const;

export type MatchStatusName = (typeof MATCH_STATUSES)[number];

/** pt-BR display labels for the dashboard "Status" column. */
export const MATCH_STATUS_LABELS: Record<MatchStatusName, string> = {
  APROVADO: "Aprovado",
  PENDENTE: "Pendente",
};

/**
 * Derive the review status of a match from its origin.
 *
 * A `MANUAL` match was created or approved by a human — it is, by
 * definition, approved. `AI` and `RULE` matches are automatic suggestions
 * pending human review (`approveMatch()` promotes them to MANUAL).
 */
export function matchStatusFromSource(matchedBy: MatchSource | MatchSourceName): MatchStatusName {
  return matchedBy === "MANUAL" ? "APROVADO" : "PENDENTE";
}
