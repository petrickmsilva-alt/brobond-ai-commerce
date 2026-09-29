/**
 * Creator Discovery Engine — module contracts (PR003).
 *
 * These interfaces are the plug-in surface of the creators module. PR003
 * ships a **mock collector only** — no TikTok API, no scraping, no Shopee,
 * no OpenAI. The **multi-source architecture** is already in place: every
 * collector declares its `CreatorSource`, is resolved exclusively through
 * `getCreatorCollector()` (`modules/creators/discovery/collector.factory.ts`)
 * and returns `CreatorCandidate[]` from `collect()`.
 *
 * CLIENT-SAFE on purpose: this file must never import `@prisma/client` as a
 * runtime value (only as a type) — the dashboard toolbar imports the niche /
 * status / source lists to render its filters.
 */

// ------------------------------------------------------------------
// Niches
// ------------------------------------------------------------------

/**
 * Canonical content niches tracked by the Creator CRM. Single source of
 * truth — reused by the mock collector, the Zod validators
 * (`modules/creators/crm/validators/creator.validator.ts`), the seed and
 * the dashboard niche filter.
 */
export const CREATOR_NICHES = ["Moda", "Casual", "Street", "Fitness", "Executivo"] as const;

export type CreatorNicheName = (typeof CREATOR_NICHES)[number];

/**
 * Niches the score engine matches against by default. A workspace may pass
 * its own targets to `scoreCreator()`; the default keeps every tracked
 * niche (fashion vertical), matching the seed distribution.
 */
export const DEFAULT_TARGET_NICHES: readonly CreatorNicheName[] = CREATOR_NICHES;

// ------------------------------------------------------------------
// Sources
// ------------------------------------------------------------------

/**
 * PR003 — the creator data sources. Kept in sync with the Prisma
 * `CreatorSource` enum (`prisma/schema.prisma`); the sync is pinned by
 * `tests/creator-source.test.ts`.
 */
export const CREATOR_SOURCES = ["MOCK", "TIKTOK", "INSTAGRAM", "SHOPEE", "MANUAL"] as const;

export type CreatorSourceName = (typeof CREATOR_SOURCES)[number];

/**
 * The default source. Every profile imported by the discovery pipeline
 * without an explicit source is MOCK-sourced — same convention as
 * PR002.1 (TrendSource).
 */
export const DEFAULT_CREATOR_SOURCE: CreatorSourceName = "MOCK";

/** pt-BR display labels for the dashboard "Origem" filter. */
export const CREATOR_SOURCE_LABELS: Record<CreatorSourceName, string> = {
  MOCK: "Mock",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  SHOPEE: "Shopee",
  MANUAL: "Manual",
};

// ------------------------------------------------------------------
// Pipeline status
// ------------------------------------------------------------------

/**
 * The CRM pipeline, in funnel order. Kept in sync with the Prisma
 * `CreatorStatus` enum (`prisma/schema.prisma`); pinned by
 * `tests/creator-source.test.ts`.
 */
export const CREATOR_STATUSES = [
  "NEW",
  "QUALIFIED",
  "CONTACTED",
  "NEGOTIATING",
  "ACTIVE",
  "ARCHIVED",
] as const;

export type CreatorStatusName = (typeof CREATOR_STATUSES)[number];

/** The status every new profile starts at. */
export const DEFAULT_CREATOR_STATUS: CreatorStatusName = "NEW";

/** pt-BR display labels for the pipeline (Kanban, table badge, filters). */
export const CREATOR_STATUS_LABELS: Record<CreatorStatusName, string> = {
  NEW: "Novo",
  QUALIFIED: "Qualificado",
  CONTACTED: "Contatado",
  NEGOTIATING: "Negociando",
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
};

/**
 * Allowed status transitions (PR003 pipeline). The funnel moves one step
 * forward at a time, may step one position back (a negotiation that falls
 * through returns to CONTACTED), and any live stage may archive. ARCHIVED
 * profiles may only return to NEW (reactivation restarts the funnel).
 *
 * Self-transitions are allowed (idempotent re-set) so the UI never has to
 * special-case the current stage.
 */
export const CREATOR_STATUS_TRANSITIONS: Record<CreatorStatusName, readonly CreatorStatusName[]> = {
  NEW: ["NEW", "QUALIFIED", "ARCHIVED"],
  QUALIFIED: ["QUALIFIED", "CONTACTED", "NEW", "ARCHIVED"],
  CONTACTED: ["CONTACTED", "NEGOTIATING", "QUALIFIED", "ARCHIVED"],
  NEGOTIATING: ["NEGOTIATING", "ACTIVE", "CONTACTED", "ARCHIVED"],
  ACTIVE: ["ACTIVE", "NEGOTIATING", "ARCHIVED"],
  ARCHIVED: ["ARCHIVED", "NEW"],
};

/** Whether a profile may move from one pipeline status to another. */
export function canTransitionCreatorStatus(
  from: CreatorStatusName,
  to: CreatorStatusName,
): boolean {
  const allowed = CREATOR_STATUS_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Statuses that count towards the "Contatados" KPI (already reached out). */
export const CONTACTED_STATUSES: readonly CreatorStatusName[] = [
  "CONTACTED",
  "NEGOTIATING",
  "ACTIVE",
];

// ------------------------------------------------------------------
// Collector contract
// ------------------------------------------------------------------

/**
 * A raw creator candidate as collected from a source (mock today; TikTok /
 * Instagram / Shopee APIs in a future PR). All numbers are plain numbers;
 * percents use the 0–100 scale.
 */
export interface CreatorCandidate {
  /** Identifier on the source platform (dedupe key with `source`). */
  externalId: string;
  /** Public handle, e.g. "@ana.moda". */
  handle: string;
  displayName: string;
  niche: CreatorNicheName;
  /** Total followers. */
  followers: number;
  /** Average views per post. */
  avgViews: number;
  /** Engagement rate in percent (0–100), e.g. 8.4 = 8.4%. */
  engagementRate: number;
  /** Publishing frequency, posts per week (may be fractional). */
  postsPerWeek: number;
  /** Follower growth over the last 30 days, in percent. */
  growthRate: number;
  /** Content quality / brand-safety, 0–100. */
  qualityScore: number;
  /** Optional avatar URL (rendered as initials when absent). */
  avatarUrl?: string;
  /** Free-form labels persisted as `CreatorTag` rows. */
  tags?: string[];
}

/** The subset of a candidate the score engine consumes. */
export type CreatorScoreInput = Pick<
  CreatorCandidate,
  "engagementRate" | "postsPerWeek" | "growthRate" | "qualityScore"
> & {
  /** Niche match in percent (0–100) — see `calculateNicheMatch()`. */
  nicheMatch: number;
};

/** A candidate enriched with its 0–100 `creatorScore`. */
export interface ScoredCreator extends CreatorCandidate {
  creatorScore: number;
}

/**
 * A creator data source (PR003 contract). Implementations must be
 * side-effect free and return everything the pipeline needs from
 * `collect()` — they are resolved through `getCreatorCollector(source)`,
 * never instantiated ad hoc by callers and never chosen via a `switch`.
 */
export interface CreatorCollector {
  /** Which source this collector fetches from (Prisma `CreatorSourceName`). */
  readonly source: CreatorSourceName;
  /**
   * Discover creators. The mock implementation returns exactly 100
   * deterministic candidates; a real provider returns live data.
   */
  collect(): Promise<CreatorCandidate[]>;
}

/**
 * Invoke a creator collector through its canonical `collect()`. The alias
 * exists so the trends-era calling convention (`collectDailyTrends`) can be
 * reused if a legacy collector is ever adapted to this contract.
 */
export async function collectCreatorCandidates(
  collector: CreatorCollector,
): Promise<CreatorCandidate[]> {
  if (typeof collector.collect === "function") return collector.collect();
  throw new Error("CreatorCollector must implement collect().");
}
