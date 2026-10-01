import "server-only";

import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { ConnectorProvider } from "@prisma/client";
import { log } from "@/lib/observability/logger";
import { AsyncInfrastructureError, getAsyncConfig } from "./config";

export const OUTBOX_DISPATCH_QUEUE = "outbox-dispatch";
export const SALE_INGESTION_QUEUE = "sale-ingestion";

let connection: IORedis | null = null;
let queue: Queue | null = null;
let saleIngestionQueue: Queue | null = null;

function getConnection(): IORedis {
  if (connection) return connection;
  const config = getAsyncConfig();
  connection = new IORedis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
  connection.on("error", (error) => {
    log({
      event: "ASYNC_REDIS_CONNECTION_ERROR",
      level: "error",
      context: { error },
    });
  });
  return connection;
}

export function getOutboxQueue(): Queue {
  if (queue) return queue;
  queue = new Queue(OUTBOX_DISPATCH_QUEUE, {
    connection: getConnection(),
    prefix: getAsyncConfig().redisPrefix,
  });
  return queue;
}

export function getSaleIngestionQueue(): Queue {
  if (saleIngestionQueue) return saleIngestionQueue;
  saleIngestionQueue = new Queue(SALE_INGESTION_QUEUE, {
    connection: getConnection(),
    prefix: getAsyncConfig().redisPrefix,
  });
  return saleIngestionQueue;
}

/**
 * The shared Redis connection — BullMQ `Worker` instances must reuse the
 * same connection options as their queues (a worker never enqueues, but it
 * needs the identical `prefix` topology to consume the right queue).
 */
export function getAsyncRedisConnection(): IORedis {
  return getConnection();
}

export async function assertAsyncReady(): Promise<void> {
  const redis = getConnection();
  try {
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error(`Unexpected Redis response: ${pong}`);
  } catch (error) {
    throw new AsyncInfrastructureError("Redis is unavailable for asynchronous processing.", {
      cause: error,
    });
  }
}

export async function enqueueOutboxDispatch(eventId: string): Promise<void> {
  try {
    await getOutboxQueue().add(
      OUTBOX_DISPATCH_QUEUE,
      { eventId },
      { jobId: eventId, removeOnComplete: 1_000, removeOnFail: 5_000 },
    );
  } catch (error) {
    log({
      event: "OUTBOX_ENQUEUE_FAILED",
      level: "error",
      context: { eventId, error },
    });
    throw new AsyncInfrastructureError("Unable to enqueue durable outbox event.", { cause: error });
  }
}

/** Job payload of the sale-ingestion queue (PR014 — Motor Financeiro). */
export interface SaleIngestionJobData {
  organizationId: string;
  provider: ConnectorProvider;
  externalEventId: string;
}

/**
 * Enqueue one webhook delivery for background sale ingestion (PR014).
 *
 * `jobId` is the durable delivery key — providers deliver at-least-once, so
 * a replayed Mercado Livre / Mercado Pago notification coalesces into the
 * same job instead of piling duplicates onto the queue. The `Sale` upsert on
 * the `(organizationId, channel, externalOrderId)` unique index remains the
 * final idempotency barrier either way.
 */
export async function enqueueSaleIngestion(
  data: SaleIngestionJobData,
  options: { jobId?: string } = {},
): Promise<void> {
  const jobId = options.jobId ?? `${data.organizationId}:${data.provider}:${data.externalEventId}`;
  try {
    await getSaleIngestionQueue().add(SALE_INGESTION_QUEUE, data, {
      jobId,
      removeOnComplete: 1_000,
      removeOnFail: 10_000,
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
    });
  } catch (error) {
    log({
      event: "SALE_INGESTION_ENQUEUE_FAILED",
      level: "error",
      context: { ...data, error },
    });
    throw new AsyncInfrastructureError("Unable to enqueue sale ingestion job.", { cause: error });
  }
}

export async function closeAsyncInfrastructure(): Promise<void> {
  await Promise.all([queue?.close(), saleIngestionQueue?.close(), connection?.quit()]);
  queue = null;
  saleIngestionQueue = null;
  connection = null;
}
