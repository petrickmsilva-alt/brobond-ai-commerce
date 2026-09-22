import "server-only";
import { AuthorizationError } from "@/lib/rbac";
import { toCreateTrendDTO } from "../dto/create-trend.dto";
import type { TrendCollector, TrendCategoryName } from "../interfaces/trend.interface";
import { trendRepository, type TrendRepository } from "../repositories/trend.repository";
import { createTrendSchema, normalizeKeyword } from "../validators/trend.validator";
import { getTrendCollector } from "./collector";
import { scoreTrend } from "./scorer";

/**
 * Trend Hunter Scheduler (PR002).
 *
 * Defines the `SchedulerJob` contract and registers the first job:
 * `collect-daily-trends` — collect → score → persist.
 *
 * IMPORTANT: execution is **manual only** in PR002. No cron, no interval,
 * no background worker is registered anywhere — an ADMIN triggers the job
 * from the dashboard (`/dashboard/trends`). The `schedule` field is part of
 * the interface so a future PR can wire a real scheduler without touching
 * callers.
 */

/** Outcome of one scheduler job run — success or failure, never a throw
 * (except authorization errors, which are re-thrown for HTTP mapping). */
export interface SchedulerJobResult {
  job: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Signals the source returned. */
  collected: number;
  snapshotsCreated: number;
  keywordsUpserted: number;
  categoriesUpserted: number;
  /** Best keyword of the run (highest score), when any signal was collected. */
  topKeyword: string | null;
  topScore: number | null;
  error?: string;
}

/** Contract every scheduled (currently manual) job implements. */
export interface SchedulerJob {
  /** Stable identifier, e.g. "collect-daily-trends". */
  readonly key: string;
  /** Human-readable name (shown in the UI). */
  readonly name: string;
  readonly description: string;
  /**
   * Cron expression — RESERVED for a future PR. Deliberately `undefined`
   * in PR002: no cron is registered, jobs run manually only.
   */
  readonly schedule?: string;
  /** Run the job for one tenant. */
  execute(organizationId: string): Promise<SchedulerJobResult>;
}

/** Dependencies of the collection job — injectable for testing. */
export interface TrendJobDependencies {
  collector?: TrendCollector;
  repository?: TrendRepository;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the `collect-daily-trends` job.
 *
 * Flow: collector.collectDailyTrends() → score each signal with the score
 * engine → validate each payload (Zod) → persist snapshots → aggregate
 * keyword frequencies → materialize category scores (average of the run).
 */
export function createCollectDailyTrendsJob(deps: TrendJobDependencies = {}): SchedulerJob {
  const collector = deps.collector ?? getTrendCollector();
  const repository = deps.repository ?? trendRepository;

  return {
    key: "collect-daily-trends",
    name: "Coleta diária de tendências",
    description:
      "Coleta as tendências do dia na fonte configurada (mock no PR002), calcula o score de cada uma e persiste os snapshots no workspace.",
    async execute(organizationId) {
      const startedAt = new Date();
      let collected = 0;
      let snapshotsCreated = 0;
      let keywordsUpserted = 0;
      let categoriesUpserted = 0;

      try {
        const signals = await collector.collectDailyTrends();
        collected = signals.length;

        // Score + validate every signal before anything is persisted.
        // Keywords are canonicalized (lowercase, single spaces) so that
        // "Camisa Masculina" and "camisa  masculina" aggregate together.
        const payloads = signals.map((signal) => {
          const scored = scoreTrend({ ...signal, keyword: normalizeKeyword(signal.keyword) });
          return createTrendSchema.parse(toCreateTrendDTO(scored, scored.trendScore));
        });

        for (const payload of payloads) {
          await repository.createSnapshot(organizationId, payload);
          snapshotsCreated += 1;
        }

        // Keyword frequency: +1 per occurrence in this run (tenant-scoped upsert).
        const keywordCounts = new Map<string, number>();
        for (const payload of payloads) {
          keywordCounts.set(payload.keyword, (keywordCounts.get(payload.keyword) ?? 0) + 1);
        }
        for (const [keyword, count] of keywordCounts) {
          await repository.upsertKeyword(organizationId, keyword, count);
          keywordsUpserted += 1;
        }

        // Category score: average score of the run's trends, per category.
        const scoresByCategory = new Map<TrendCategoryName, number[]>();
        for (const payload of payloads) {
          const list = scoresByCategory.get(payload.category) ?? [];
          list.push(payload.trendScore);
          scoresByCategory.set(payload.category, list);
        }
        for (const [category, scores] of scoresByCategory) {
          const average = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
          await repository.upsertCategory(organizationId, category, average);
          categoriesUpserted += 1;
        }

        const best = [...payloads].sort((a, b) => b.trendScore - a.trendScore)[0];
        const finishedAt = new Date();

        return {
          job: "collect-daily-trends",
          status: "success",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          collected,
          snapshotsCreated,
          keywordsUpserted,
          categoriesUpserted,
          topKeyword: best?.keyword ?? null,
          topScore: best?.trendScore ?? null,
        };
      } catch (error) {
        // Authorization failures must surface as 401/403, not as a "failed job".
        if (error instanceof AuthorizationError) throw error;
        const finishedAt = new Date();
        return {
          job: "collect-daily-trends",
          status: "failed",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          collected,
          snapshotsCreated,
          keywordsUpserted,
          categoriesUpserted,
          topKeyword: null,
          topScore: null,
          error: errorMessage(error),
        };
      }
    },
  };
}

/** Default job instance (mock collector + app Prisma repository). */
export const collectDailyTrendsJob = createCollectDailyTrendsJob();

/**
 * The scheduler registry. PR002 registers a single job and exposes it for
 * MANUAL execution only — there is no cron anywhere (by design).
 */
export const trendScheduler = {
  jobs: [collectDailyTrendsJob] as readonly SchedulerJob[],
  getJob(key: string): SchedulerJob | undefined {
    return this.jobs.find((job) => job.key === key);
  },
};
