import "server-only";

import { Worker, type Job } from "bullmq";
import { log } from "@/lib/observability/logger";
import { reportError } from "@/lib/observability/error-reporter";
import {
  SALE_INGESTION_QUEUE,
  enqueueSaleIngestion,
  getAsyncRedisConnection,
  type SaleIngestionJobData,
} from "@/lib/async/queue";
import { getAsyncConfig } from "@/lib/async/config";
import { marketplaceRepository } from "../core/connector.repository";
import { SALE_INGESTION_PROVIDERS, processSaleIngestionEvent } from "./sale-ingestion.service";

/**
 * Sale-ingestion worker runtime (PR014 — Motor Financeiro Unificado).
 *
 * `startSaleIngestionWorker()` consumes the `sale-ingestion` BullMQ queue
 * (fed by the Mercado Livre / Mercado Pago webhook routes) and processes
 * each delivery through `processSaleIngestionEvent()` — provider API fetch
 * plus the idempotent `Sale` upsert — in the background, never on the
 * request path.
 *
 * `startPendingSaleEventScanner()` is the self-healing loop: webhook
 * deliveries that were durably stored while Redis (or the worker) was down
 * remain in the `ConnectorEvent` inbox with `processedAt = null`; the
 * scanner re-enqueues them once the infrastructure is back. Retry jobs use
 * a timestamped `jobId` so a queued/completed attempt never blocks a
 * later retry of the same delivery key.
 */

/** How long a delivery waits before the scanner may re-enqueue it. */
const SCANNER_GRACE_MS = 60_000;
/** How often the scanner sweeps the pending inbox. */
const SCANNER_INTERVAL_MS = 30_000;
/**
 * Deliveries older than this are dead-lettered by the scanner: providers
 * stop redelivering long before this, so the row is almost certainly
 * unrecoverable (e.g. the order was deleted provider-side).
 */
const SCANNER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const SCANNER_BATCH_LIMIT = 50;

async function processJob(job: Job<SaleIngestionJobData>) {
  const result = await processSaleIngestionEvent(job.data);
  log({
    event: "SALE_INGESTION_JOB_COMPLETED",
    level: "info",
    context: { jobId: job.id, ...result },
  });
  return result;
}

/** Start the BullMQ worker for the sale-ingestion queue. */
export function startSaleIngestionWorker(): Worker<SaleIngestionJobData> {
  const config = getAsyncConfig();
  const worker = new Worker<SaleIngestionJobData>(SALE_INGESTION_QUEUE, processJob, {
    connection: getAsyncRedisConnection(),
    prefix: config.redisPrefix,
    concurrency: config.concurrency,
  });

  worker.on("failed", (job, error) => {
    reportError(error, {
      correlationId: job?.id ?? undefined,
      event: "SALE_INGESTION_JOB_FAILED",
    });
    log({
      event: "SALE_INGESTION_JOB_FAILED",
      level: "error",
      context: {
        jobId: job?.id ?? null,
        attemptsMade: job?.attemptsMade ?? 0,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  });

  return worker;
}

/**
 * One scanner sweep: re-enqueue pending sale events. Returns how many
 * deliveries were (re)queued. Never throws — an infrastructure outage is
 * logged and retried by the next sweep.
 */
export async function requeuePendingSaleEvents(): Promise<number> {
  const now = Date.now();
  let pending: Array<{
    organizationId: string;
    provider: (typeof SALE_INGESTION_PROVIDERS)[number];
    externalEventId: string;
  }>;
  try {
    pending = await marketplaceRepository.listPendingSaleEvents({
      providers: [...SALE_INGESTION_PROVIDERS],
      before: new Date(now - SCANNER_GRACE_MS),
      after: new Date(now - SCANNER_MAX_AGE_MS),
      limit: SCANNER_BATCH_LIMIT,
    });
  } catch (error) {
    log({
      event: "SALE_INGESTION_SCAN_FAILED",
      level: "error",
      context: { error },
    });
    return 0;
  }

  let enqueued = 0;
  for (const delivery of pending) {
    try {
      await enqueueSaleIngestion(delivery, {
        jobId: `${delivery.organizationId}:${delivery.provider}:${delivery.externalEventId}:retry:${now}`,
      });
      enqueued += 1;
    } catch {
      // Redis went away mid-sweep — the next sweep picks up the remainder.
      break;
    }
  }

  if (enqueued > 0) {
    log({
      event: "SALE_INGESTION_REQUEUED",
      level: "info",
      context: { enqueued, pending: pending.length },
    });
  }
  return enqueued;
}

/**
 * Start the periodic self-healing sweep. Returns the stop handle — the
 * caller MUST clear it on shutdown alongside the worker.
 */
export function startPendingSaleEventScanner(): () => void {
  // Sweep immediately on boot so the backlog recorded while the worker was
  // down starts flowing without waiting a full interval.
  void requeuePendingSaleEvents();
  const timer = setInterval(() => void requeuePendingSaleEvents(), SCANNER_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
