import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR014 — webhook ingress → BullMQ handoff.
 *
 * Pins the unified provider webhook contract for the financial engine:
 * verified, tenant-resolved deliveries are durably recorded in the
 * `ConnectorEvent` inbox and — when they carry sale data (Mercado Livre
 * orders, Mercado Pago payments) — enqueued to the sale-ingestion worker
 * instead of being stamped processed. The provider always gets a fast 200.
 */

vi.mock("@/lib/observability/logger", () => ({ log: vi.fn() }));

vi.mock("@/lib/async/queue", () => ({
  SALE_INGESTION_QUEUE: "sale-ingestion",
  enqueueSaleIngestion: vi.fn(async () => undefined),
}));

vi.mock("@/modules/marketplace/ingestion/sale-ingestion.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/marketplace/ingestion/sale-ingestion.service")>();
  return { ...actual };
});

vi.mock("@/modules/marketplace/core/connector.repository", () => ({
  marketplaceRepository: {
    findByShopId: vi.fn(),
    hasEvent: vi.fn(),
    recordEvent: vi.fn(async () => null),
    markEventProcessed: vi.fn(async () => undefined),
  },
}));

import { enqueueSaleIngestion } from "@/lib/async/queue";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { handleProviderWebhook } from "@/modules/marketplace/webhooks/handlers";

const mockedEnqueue = vi.mocked(enqueueSaleIngestion);
const mockedRepository = vi.mocked(marketplaceRepository);

/** A signed-free local request against the unified webhook route handler. */
function webhookRequest(body: unknown, url = "https://app.example.com/api/webhooks/x"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MERCADOLIVRE_WEBHOOK_SECRET;
  delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
});

describe("handleProviderWebhook — sale deliveries go to the worker", () => {
  it("enqueues a Mercado Livre orders notification and leaves it unprocessed", async () => {
    mockedRepository.findByShopId.mockResolvedValue({
      id: "conn_1",
      organizationId: "org_1",
    } as never);
    mockedRepository.hasEvent.mockResolvedValue(false);

    const result = await handleProviderWebhook(
      "MERCADOLIVRE",
      webhookRequest({
        _id: "meli-evt-1",
        resource: "/orders/123456789",
        user_id: "12345",
        topic: "orders",
      }),
      JSON.stringify({
        _id: "meli-evt-1",
        resource: "/orders/123456789",
        user_id: "12345",
        topic: "orders",
      }),
    );

    expect(result).toEqual({ received: true });
    expect(mockedRepository.recordEvent).toHaveBeenCalledWith("org_1", {
      provider: "MERCADOLIVRE",
      externalEventId: "meli:meli-evt-1",
      connectorId: "conn_1",
      topic: "orders",
      payload: expect.objectContaining({ topic: "orders" }),
    });
    expect(mockedEnqueue).toHaveBeenCalledWith({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:meli-evt-1",
    });
    // The worker — not the request — stamps processedAt after the upsert.
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("enqueues a Mercado Pago payment notification", async () => {
    mockedRepository.findByShopId.mockResolvedValue({
      id: "conn_2",
      organizationId: "org_2",
    } as never);
    mockedRepository.hasEvent.mockResolvedValue(false);

    const body = {
      id: "mp-evt-7",
      type: "payment",
      user_id: "777",
      data: { id: "pay-001" },
      date_created: "2026-10-01T10:00:00.000Z",
    };

    const result = await handleProviderWebhook(
      "MERCADOPAGO",
      webhookRequest(body, "https://app.example.com/api/webhooks/mercadopago"),
      JSON.stringify(body),
    );

    expect(result).toEqual({ received: true });
    expect(mockedEnqueue).toHaveBeenCalledWith({
      organizationId: "org_2",
      provider: "MERCADOPAGO",
      externalEventId: "mp:mp-evt-7",
    });
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it.each([
    ["Payments", "/payments/1"],
    ["Orders_v2", "/orders/2"],
    ["Items", "/items/MLB1"],
    ["Shipments", "/shipments/3"],
  ])("normalizes and enqueues the enabled Meli %s topic", async (topic, resource) => {
    mockedRepository.findByShopId.mockResolvedValue({
      id: "conn_1",
      organizationId: "org_1",
    } as never);
    mockedRepository.hasEvent.mockResolvedValue(false);

    const body = { _id: `meli-${topic}`, resource, user_id: "12345", topic };
    const result = await handleProviderWebhook(
      "MERCADOLIVRE",
      webhookRequest(body),
      JSON.stringify(body),
    );

    expect(result).toEqual({ received: true });
    expect(mockedRepository.recordEvent).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ topic: topic.toLowerCase() }),
    );
    expect(mockedEnqueue).toHaveBeenCalledWith({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: `meli:meli-${topic}`,
    });
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("a Redis outage never fails the provider: the event stays pending", async () => {
    mockedRepository.findByShopId.mockResolvedValue({
      id: "conn_1",
      organizationId: "org_1",
    } as never);
    mockedRepository.hasEvent.mockResolvedValue(false);
    mockedEnqueue.mockRejectedValueOnce(new Error("redis down"));

    const body = {
      _id: "meli-evt-3",
      resource: "/orders/999",
      user_id: "12345",
      topic: "orders_v2",
    };

    const result = await handleProviderWebhook(
      "MERCADOLIVRE",
      webhookRequest(body),
      JSON.stringify(body),
    );

    expect(result).toEqual({ received: true });
    // Unstamped on purpose — the worker's pending scanner self-heals it.
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("replayed deliveries are deduped by the inbox unique key", async () => {
    mockedRepository.findByShopId.mockResolvedValue({
      id: "conn_1",
      organizationId: "org_1",
    } as never);
    mockedRepository.hasEvent.mockResolvedValue(true);

    const body = {
      _id: "meli-evt-1",
      resource: "/orders/123456789",
      user_id: "12345",
      topic: "orders",
    };

    const result = await handleProviderWebhook(
      "MERCADOLIVRE",
      webhookRequest(body),
      JSON.stringify(body),
    );

    expect(result).toEqual({ received: true, duplicate: true });
    expect(mockedRepository.recordEvent).not.toHaveBeenCalled();
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });

  it("deliveries from an unknown seller account are ignored", async () => {
    mockedRepository.findByShopId.mockResolvedValue(null);

    const body = {
      _id: "meli-evt-4",
      resource: "/orders/42",
      user_id: "unknown",
      topic: "orders",
    };

    const result = await handleProviderWebhook(
      "MERCADOLIVRE",
      webhookRequest(body),
      JSON.stringify(body),
    );

    expect(result).toEqual({ received: true, ignored: true });
    expect(mockedRepository.recordEvent).not.toHaveBeenCalled();
    expect(mockedEnqueue).not.toHaveBeenCalled();
  });
});
