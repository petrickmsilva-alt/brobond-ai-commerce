import "server-only";

import { Queue } from "bullmq";
import IORedis from "ioredis";
import { log } from "@/lib/observability/logger";
import { AsyncInfrastructureError, getAsyncConfig } from "./config";

export const OUTBOX_DISPATCH_QUEUE = "outbox-dispatch";

let connection: IORedis | null = null;
let queue: Queue | null = null;

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

export async function closeAsyncInfrastructure(): Promise<void> {
  await Promise.all([queue?.close(), connection?.quit()]);
  queue = null;
  connection = null;
}
