import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR014 — sale-ingestion worker self-healing scanner.
 *
 * Deliveries recorded while Redis (or the worker) was down stay in the
 * `ConnectorEvent` inbox with `processedAt = null`. The scanner re-enqueues
 * them with a timestamped jobId so a queued/completed attempt can never
 * block a later retry of the same delivery key.
 */

vi.mock("@/lib/observability/logger", () => ({ log: vi.fn() }));
vi.mock("@/lib/observability/error-reporter", () => ({ reportError: vi.fn() }));

vi.mock("@/lib/async/queue", () => ({
  SALE_INGESTION_QUEUE: "sale-ingestion",
  getAsyncConfig: vi.fn(() => ({
    redisUrl: "redis://localhost:6379",
    redisPrefix: "brobond",
    concurrency: 5,
  })),
  getAsyncRedisConnection: vi.fn(() => ({})),
  enqueueSaleIngestion: vi.fn(async () => undefined),
}));

vi.mock("@/modules/marketplace/core/connector.repository", () => ({
  marketplaceRepository: {
    listPendingSaleEvents: vi.fn(),
  },
}));

import { enqueueSaleIngestion } from "@/lib/async/queue";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { requeuePendingSaleEvents } from "@/modules/marketplace/ingestion/sale-ingestion.worker";

const mockedEnqueue = vi.mocked(enqueueSaleIngestion);
const mockedListPending = vi.mocked(marketplaceRepository.listPendingSaleEvents);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
});

describe("requeuePendingSaleEvents", () => {
  it("re-enqueues pending deliveries with a unique retry jobId", async () => {
    mockedListPending.mockResolvedValue([
      { organizationId: "org_1", provider: "MERCADOLIVRE", externalEventId: "meli:a" },
      { organizationId: "org_2", provider: "MERCADOPAGO", externalEventId: "mp:b" },
    ]);

    const enqueued = await requeuePendingSaleEvents();

    expect(enqueued).toBe(2);
    expect(mockedListPending).toHaveBeenCalledWith({
      providers: ["MERCADOLIVRE", "MERCADOPAGO"],
      before: new Date("2026-10-01T11:59:00.000Z"), // 60s grace
      after: expect.any(Date), // 7-day dead-letter window
      limit: 50,
    });
    expect(mockedEnqueue).toHaveBeenCalledTimes(2);
    expect(mockedEnqueue).toHaveBeenCalledWith(
      { organizationId: "org_1", provider: "MERCADOLIVRE", externalEventId: "meli:a" },
      {
        jobId: `org_1:MERCADOLIVRE:meli:a:retry:${new Date("2026-10-01T12:00:00.000Z").getTime()}`,
      },
    );
  });

  it("stops the sweep when Redis fails mid-batch (next sweep heals)", async () => {
    mockedListPending.mockResolvedValue([
      { organizationId: "org_1", provider: "MERCADOLIVRE", externalEventId: "meli:a" },
      { organizationId: "org_2", provider: "MERCADOLIVRE", externalEventId: "meli:b" },
    ]);
    mockedEnqueue.mockRejectedValueOnce(new Error("redis down"));

    const enqueued = await requeuePendingSaleEvents();

    expect(enqueued).toBe(0);
    expect(mockedEnqueue).toHaveBeenCalledTimes(1);
  });

  it("never throws on a repository outage", async () => {
    mockedListPending.mockRejectedValue(new Error("postgres down"));

    await expect(requeuePendingSaleEvents()).resolves.toBe(0);
  });

  it("reports nothing to enqueue when the inbox is clean", async () => {
    mockedListPending.mockResolvedValue([]);

    await expect(requeuePendingSaleEvents()).resolves.toBe(0);
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});
