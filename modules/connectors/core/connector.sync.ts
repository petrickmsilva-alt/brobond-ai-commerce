import "server-only";
import { ConnectorPlatform } from "@prisma/client";
import type { ConnectorState } from "@prisma/client";
import { AuthorizationError } from "@/lib/rbac";
import { toCreateExternalContentDTO } from "./connector.dto";
import { getConnector } from "./connector.factory";
import type { Connector, NormalizedContent } from "./connector.interface";
import { ConnectorNotImplementedError } from "./connector.interface";
import {
  connectorRepository,
  type ConnectorRepository,
  type ConnectorSyncCounters,
} from "./connector.repository";
import { normalizedContentSchema, SYNC_LIMIT_DEFAULT } from "./connector.validator";

/**
 * Connector Sync Service (PR005) — the single orchestration that turns a
 * connector's normalized output into persisted `ExternalContent` rows and
 * an updated `ConnectorStatus`.
 *
 * Flow per run:
 *   getConnector(platform) → fetchContent() → validate each item (Zod) →
 *   dedupe on (organizationId, platform, externalId) → persist as
 *   IMPORTED / DUPLICATE / FAILED → update the connector state + counters.
 *
 * IMPORTANT — execution is **manual only**. No cron, no interval, no
 * background worker is registered anywhere: an ADMIN triggers the sync from
 * `/dashboard/connectors`. The `schedule` field on the job descriptor exists
 * so a future PR can wire a real scheduler without touching callers, exactly
 * like the trends (PR002) and creators (PR003) schedulers.
 *
 * A placeholder connector does NOT crash the run: it is recorded as a
 * failure on `ConnectorStatus` (state ERROR + `lastError`) and reported in
 * the result — the dashboard stays usable.
 */

/** Outcome of one sync run — success or failure, never a throw (except
 * authorization errors, which are re-thrown for HTTP mapping). */
export interface ConnectorSyncResult {
  job: string;
  platform: ConnectorPlatform;
  status: "success" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Items the connector returned. */
  fetched: number;
  /** New rows persisted (status IMPORTED). */
  imported: number;
  /** Items already known — dedupe hit (status DUPLICATE). */
  duplicates: number;
  /** Items rejected by validation or by a persistence error (status FAILED). */
  failed: number;
  /** Resulting connector state (ACTIVE on success, ERROR on failure). */
  state: ConnectorState;
  error?: string;
}

/** Contract every connector job implements (mirrors PR002/PR003). */
export interface ConnectorSyncJob {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /**
   * Cron expression — RESERVED for a future PR. Deliberately `undefined`
   * in PR005: no cron is registered, syncs run manually only.
   */
  readonly schedule?: string;
  run(organizationId: string, platform: ConnectorPlatform): Promise<ConnectorSyncResult>;
}

/** Dependencies of the sync job — injectable for testing. */
export interface ConnectorSyncDependencies {
  /** Resolve a platform to its adapter. Defaults to the factory. */
  resolve?: (platform: ConnectorPlatform) => Connector;
  repository?: ConnectorRepository;
  /** Max items to pull per run. */
  limit?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build the `sync-connector` job.
 *
 * Every item is validated with `normalizedContentSchema` BEFORE it reaches
 * the database, so a misbehaving adapter produces FAILED rows instead of
 * corrupt content. Dedupe is a tenant-scoped lookup on
 * `(platform, externalId)`: a known item is stored as DUPLICATE and the
 * original row's engagement numbers are refreshed.
 */
export function createConnectorSyncJob(deps: ConnectorSyncDependencies = {}): ConnectorSyncJob {
  const resolve = deps.resolve ?? getConnector;
  const repository = deps.repository ?? connectorRepository;
  const limit = deps.limit ?? SYNC_LIMIT_DEFAULT;

  return {
    key: "sync-connector",
    name: "Sincronização de conector",
    description:
      "Busca conteúdo na plataforma configurada (Mock por padrão — TikTok, Instagram e Shopee são placeholders), normaliza, deduplica e persiste os itens do workspace.",
    async run(organizationId, platform) {
      const startedAt = new Date();
      let fetched = 0;
      let imported = 0;
      let duplicates = 0;
      let failed = 0;

      const finish = (
        status: "success" | "failed",
        state: ConnectorState,
        error?: string,
      ): ConnectorSyncResult => {
        const finishedAt = new Date();
        return {
          job: "sync-connector",
          platform,
          status,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          fetched,
          imported,
          duplicates,
          failed,
          state,
          ...(error ? { error } : {}),
        };
      };

      try {
        const connector = resolve(platform);
        const status = await repository.ensureStatus(organizationId, platform);

        let items: NormalizedContent[];
        try {
          items = await connector.fetchContent({ limit, organizationId });
        } catch (error) {
          // A placeholder (or a provider outage, later) is a recorded
          // failure — never an exception escaping to the UI.
          if (error instanceof AuthorizationError) throw error;
          const message = errorMessage(error);
          const reason =
            error instanceof ConnectorNotImplementedError
              ? message
              : `Falha ao buscar conteúdo: ${message}`;
          await repository.recordSyncResult(organizationId, platform, {
            state: "ERROR" as ConnectorState,
            counters: { imported: 0, duplicates: 0, failed: 0 },
            lastError: reason,
          });
          return finish("failed", "ERROR" as ConnectorState, reason);
        }

        fetched = items.length;

        for (const item of items) {
          // 1. Validate BEFORE anything is persisted.
          const parsed = normalizedContentSchema.safeParse(item);
          if (!parsed.success) {
            const reason = parsed.error.issues.map((issue) => issue.message).join(" · ");
            failed += 1;
            await repository
              .createContent(
                organizationId,
                toCreateExternalContentDTO(
                  {
                    externalId:
                      typeof item?.externalId === "string" && item.externalId.trim() !== ""
                        ? item.externalId.trim().slice(0, 180)
                        : `invalid-${startedAt.getTime()}-${failed}`,
                    type: "POST",
                    title:
                      typeof item?.title === "string" && item.title.trim() !== ""
                        ? item.title.trim().slice(0, 300)
                        : "Item inválido",
                  },
                  platform,
                  "FAILED",
                  { connectorStatusId: status.id, errorReason: reason },
                ),
              )
              // A failed row that itself collides (same externalId twice in
              // one bad batch) must not abort the run.
              .catch(() => null);
            continue;
          }

          const content = parsed.data as NormalizedContent;

          try {
            // 2. Dedupe — tenant-scoped lookup on (platform, externalId).
            const existing = await repository.findContentByExternalId(
              organizationId,
              platform,
              content.externalId,
            );

            if (existing) {
              duplicates += 1;
              // Refresh the engagement numbers of the known row — a re-sync
              // brings fresher metrics, it does not create a second record.
              await repository.refreshContent(organizationId, existing.id, {
                views: content.views ?? 0,
                likes: content.likes ?? 0,
                shares: content.shares ?? 0,
                title: existing.title,
              });
              continue;
            }

            // 3. Persist the new item.
            await repository.createContent(
              organizationId,
              toCreateExternalContentDTO(content, platform, "IMPORTED", {
                connectorStatusId: status.id,
              }),
            );
            imported += 1;
          } catch (error) {
            if (error instanceof AuthorizationError) throw error;
            failed += 1;
            await repository
              .createContent(
                organizationId,
                toCreateExternalContentDTO(content, platform, "FAILED", {
                  connectorStatusId: status.id,
                  errorReason: errorMessage(error),
                }),
              )
              .catch(() => null);
          }
        }

        const counters: ConnectorSyncCounters = { imported, duplicates, failed };
        const state: ConnectorState =
          failed > 0 && imported === 0 && duplicates === 0
            ? ("ERROR" as ConnectorState)
            : ("ACTIVE" as ConnectorState);

        await repository.recordSyncResult(organizationId, platform, {
          state,
          counters,
          lastError: failed > 0 ? `${failed} item(ns) falharam na importação.` : null,
        });

        return finish(state === "ERROR" ? "failed" : "success", state);
      } catch (error) {
        // Authorization failures must surface as 401/403, not as a "failed job".
        if (error instanceof AuthorizationError) throw error;
        return finish("failed", "ERROR" as ConnectorState, errorMessage(error));
      }
    },
  };
}

/** Default job instance (factory resolution + app Prisma repository). */
export const connectorSyncJob = createConnectorSyncJob();

/**
 * The connector registry. PR005 registers a single job and exposes it for
 * MANUAL execution only — there is no cron anywhere (by design).
 */
export const connectorScheduler = {
  jobs: [connectorSyncJob] as readonly ConnectorSyncJob[],
  getJob(key: string): ConnectorSyncJob | undefined {
    return this.jobs.find((job) => job.key === key);
  },
  /** The default platform an ADMIN syncs from the dashboard. */
  defaultPlatform: ConnectorPlatform.MOCK,
};
