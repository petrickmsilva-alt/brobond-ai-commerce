import {
  closeAsyncInfrastructure,
  enqueueOutboxDispatch,
  assertAsyncReady,
} from "@/lib/async/queue";
import { log } from "@/lib/observability/logger";
import { reportError } from "@/lib/observability/error-reporter";
import { getPrisma } from "@/lib/prisma";
import { createTransactionalOutboxRepository } from "@/modules/async-outbox/outbox.repository";
import {
  startSaleIngestionWorker,
  startPendingSaleEventScanner,
} from "@/modules/marketplace/ingestion/sale-ingestion.worker";

const POLL_INTERVAL_MS = 1_000;
const RETRY_DELAY_MS = 30_000;
let stopping = false;

async function dispatchOnce() {
  const repository = createTransactionalOutboxRepository(getPrisma());
  const claimed = await repository.claimNext();
  if (!claimed?.claimed) return false;

  try {
    await enqueueOutboxDispatch(claimed.event.id);
    await repository.markProcessed(claimed.event.id);
    log({
      event: "OUTBOX_EVENT_DISPATCHED",
      level: "info",
      context: { eventId: claimed.event.id, topic: claimed.event.topic },
    });
  } catch (error) {
    await repository.retry(claimed.event.id, error, new Date(Date.now() + RETRY_DELAY_MS));
    reportError(error, { correlationId: claimed.event.id, event: "OUTBOX_DISPATCH_RETRY" });
  }
  return true;
}

async function run() {
  await assertAsyncReady();

  // PR014 — Motor Financeiro Unificado: alongside the outbox poller, run the
  // BullMQ worker that drains the `sale-ingestion` queue (Mercado Livre
  // orders/payments/items/shipments + Mercado Pago payments captured by the
  // webhook routes), plus the self-healing sweep that re-enqueues deliveries
  // recorded while the
  // infrastructure was unavailable.
  const saleWorker = startSaleIngestionWorker();
  const stopSaleScanner = startPendingSaleEventScanner();

  log({ event: "ASYNC_WORKER_READY", level: "info" });
  while (!stopping) {
    const dispatched = await dispatchOnce();
    if (!dispatched) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  stopSaleScanner();
  await saleWorker.close();
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log({ event: "ASYNC_WORKER_STOPPING", level: "info", context: { signal } });
  await closeAsyncInfrastructure();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

run()
  .then(() => (process.exitCode = 0))
  .catch((error) => {
    reportError(error, { event: "ASYNC_WORKER_STARTUP_FAILED" });
    process.exitCode = 1;
  });
