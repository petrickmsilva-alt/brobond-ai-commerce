import "server-only";
import { CreatorSource } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import { collectCreatorCandidates, type CreatorCollector } from "../interfaces/creator.interface";
import { deriveDailyMetric, toDiscoveryUpsertDTO } from "../crm/dto/creator.dto";
import {
  creatorRepository,
  type CreatorRepository,
} from "../crm/repositories/creator-profile.repository";
import { creatorCandidateSchema } from "../crm/validators/creator.validator";
import { getCreatorCollector } from "./collector.factory";
import { scoreCreator } from "./scorer";

/**
 * Creator Discovery Scheduler (PR003).
 *
 * Defines the `CreatorSchedulerJob` contract and registers the first job:
 * `discover-creators` — collect → validate → score → upsert → tag/metric.
 *
 * The job is **multi-source** — it receives a `CreatorSource` (default
 * `MOCK`) and resolves the collector through `getCreatorCollector()`.
 * Every persisted profile is stamped with the collector's source.
 *
 * IMPORTANT: execution is **manual only**. No cron, no interval, no
 * background worker is registered anywhere — an ADMIN triggers the job
 * from the dashboard (`/dashboard/creators`). The `schedule` field is part
 * of the interface so a future PR can wire a real scheduler without
 * touching callers.
 */

/** Outcome of one scheduler job run — success or failure, never a throw
 * (except authorization errors, which are re-thrown for HTTP mapping). */
export interface CreatorJobResult {
  job: string;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Candidates the source returned. */
  collected: number;
  /** Profiles that did not exist yet (created). */
  creatorsCreated: number;
  /** Profiles that already existed (metrics + score refreshed). */
  creatorsUpdated: number;
  /** Daily metric snapshots upserted. */
  metricsRecorded: number;
  /** Tags attached (idempotent — re-runs do not double count). */
  tagsUpserted: number;
  /** Best creator of the run (highest score), when any candidate existed. */
  topHandle: string | null;
  topScore: number | null;
  /** The source that was actually collected (the collector's). */
  source: CreatorSource;
  error?: string;
}

/** Contract every scheduled (currently manual) job implements. */
export interface CreatorSchedulerJob {
  /** Stable identifier, e.g. "discover-creators". */
  readonly key: string;
  /** Human-readable name (shown in the UI). */
  readonly name: string;
  readonly description: string;
  /**
   * Cron expression — RESERVED for a future PR. Deliberately `undefined`
   * in PR003: no cron is registered, jobs run manually only.
   */
  readonly schedule?: string;
  /** Run the job for one tenant. */
  execute(organizationId: string): Promise<CreatorJobResult>;
}

/** Dependencies of the discovery job — injectable for testing. */
export interface CreatorJobDependencies {
  /**
   * Which source to collect from. Resolved through `getCreatorCollector()`
   * when no explicit `collector` is injected. Defaults to `MOCK`.
   */
  source?: CreatorSource;
  collector?: CreatorCollector;
  repository?: CreatorRepository;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the `discover-creators` job.
 *
 * Flow: getCreatorCollector(source).collect() → validate each candidate
 * (Zod, handle canonicalized) → score it with the score engine → upsert
 * on (organizationId, source, externalId) — the CRM status is never
 * overridden by a re-import → attach tags → upsert today's metric
 * snapshot.
 *
 * The default source is `MOCK` — TikTok, Instagram and Shopee plug in
 * behind the same factory in future PRs, with zero caller changes.
 */
export function createDiscoverCreatorsJob(deps: CreatorJobDependencies = {}): CreatorSchedulerJob {
  const source = deps.source ?? CreatorSource.MOCK;
  const collector = deps.collector ?? getCreatorCollector(source);
  const repository = deps.repository ?? creatorRepository;

  return {
    key: "discover-creators",
    name: "Descoberta de creators",
    description:
      "Coleta creators na origem configurada (Mock por padrão — TikTok, Instagram e Shopee chegam em PRs futuros), valida e pontua cada perfil e atualiza o CRM com o pipeline e as métricas do dia.",
    async execute(organizationId) {
      const startedAt = new Date();
      let collected = 0;
      let creatorsCreated = 0;
      let creatorsUpdated = 0;
      let metricsRecorded = 0;
      let tagsUpserted = 0;

      try {
        const candidates = await collectCreatorCandidates(collector);
        collected = candidates.length;

        // Today's metric snapshot — UTC midnight keeps @db.Date stable.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        for (const candidate of candidates) {
          // Validate + canonicalize BEFORE anything is persisted.
          const parsed = creatorCandidateSchema.parse(candidate);
          const scored = scoreCreator(parsed);

          const { creator, created } = await repository.upsertFromDiscovery(
            organizationId,
            toDiscoveryUpsertDTO(scored, collector.source),
          );
          if (created) creatorsCreated += 1;
          else creatorsUpdated += 1;

          for (const tag of scored.tags ?? []) {
            const attached = await repository.addTag(organizationId, creator.id, tag);
            if (attached) tagsUpserted += 1;
          }

          const metric = await repository.recordMetric(
            organizationId,
            creator.id,
            deriveDailyMetric(scored, today),
          );
          if (metric) metricsRecorded += 1;
        }

        const [top] = await repository.topCreators(organizationId, { limit: 1 });
        const finishedAt = new Date();

        return {
          job: "discover-creators",
          status: "success",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          collected,
          creatorsCreated,
          creatorsUpdated,
          metricsRecorded,
          tagsUpserted,
          topHandle: top?.handle ?? null,
          topScore: top?.creatorScore ?? null,
          source: collector.source,
        };
      } catch (error) {
        // Authorization failures must surface as 401/403, not as a "failed job".
        if (error instanceof AuthorizationError) throw error;
        const finishedAt = new Date();
        return {
          job: "discover-creators",
          status: "failed",
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          collected,
          creatorsCreated,
          creatorsUpdated,
          metricsRecorded,
          tagsUpserted,
          topHandle: null,
          topScore: null,
          source: collector.source,
          error: errorMessage(error),
        };
      }
    },
  };
}

/** Default job instance (MOCK source + app Prisma repository). */
export const discoverCreatorsJob = createDiscoverCreatorsJob();

/**
 * The scheduler registry. PR003 registers a single job and exposes it for
 * MANUAL execution only — there is no cron anywhere (by design).
 */
export const creatorScheduler = {
  jobs: [discoverCreatorsJob] as readonly CreatorSchedulerJob[],
  getJob(key: string): CreatorSchedulerJob | undefined {
    return this.jobs.find((job) => job.key === key);
  },
};
