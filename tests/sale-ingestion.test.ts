import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorEvent, Sale } from "@prisma/client";

/**
 * PR014 — Motor Financeiro Unificado: sale ingestion tests.
 *
 * Pins the contract that turns verified webhook deliveries into tenant
 * revenue:
 *   - the (provider, topic) gate decides which deliveries carry sales;
 *   - the provider status mappers land on the `Sale` lifecycle;
 *   - `processSaleIngestionEvent` fetches the authoritative order/payment,
 *     upserts idempotently on the (tenant, channel, externalOrderId) key,
 *     increments the connector counters and stamps the inbox event.
 */

vi.mock("@/lib/observability/logger", () => ({ log: vi.fn() }));

vi.mock("@/modules/marketplace/core/connector.service", () => ({
  marketplaceService: {
    getValidAccessToken: vi.fn(async () => ({ accessToken: "token", shopId: "shop" })),
  },
}));

vi.mock("@/modules/marketplace/core/connector.repository", () => ({
  marketplaceRepository: {
    findEvent: vi.fn(),
    markEventProcessed: vi.fn(async () => undefined),
    incrementIngestionCounters: vi.fn(async () => null),
  },
}));

vi.mock("@/modules/connectors/core/connector.repository", () => ({
  connectorRepository: {
    recordIngestionCounters: vi.fn(async () => ({})),
  },
}));

vi.mock("@/modules/sales/sales.service", () => ({
  salesService: {
    upsertIngestedSale: vi.fn(),
  },
}));

vi.mock("@/modules/analytics/services/analytics.service", () => ({
  analyticsService: {
    refreshForSale: vi.fn(async () => 0),
  },
}));

vi.mock("@/modules/marketplace/mercadolivre/mercadolivre.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/modules/marketplace/mercadolivre/mercadolivre.service")
    >();
  return {
    ...actual,
    fetchMercadoLivreOrder: vi.fn(),
    resolveMercadoLivreNotificationOrderId: vi.fn(async (_token, topic, resource) => {
      if (topic === "items") return null;
      return /\/orders\/(\d+)/.exec(resource)?.[1] ?? null;
    }),
  };
});

vi.mock("@/modules/marketplace/mercadopago/mercadopago.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/marketplace/mercadopago/mercadopago.service")>();
  return { ...actual, fetchMercadoPagoPayment: vi.fn() };
});

import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import { salesService } from "@/modules/sales/sales.service";
import { analyticsService } from "@/modules/analytics/services/analytics.service";
import {
  fetchMercadoLivreOrder,
  meliOrderStatusToSaleStatus,
  resolveMercadoLivreNotificationOrderId,
} from "@/modules/marketplace/mercadolivre/mercadolivre.service";
import {
  fetchMercadoPagoPayment,
  mercadoPagoStatusToSaleStatus,
} from "@/modules/marketplace/mercadopago/mercadopago.service";
import {
  isSaleIngestionEvent,
  processSaleIngestionEvent,
} from "@/modules/marketplace/ingestion/sale-ingestion.service";

const mockedRepository = vi.mocked(marketplaceRepository);
const mockedFrameworkRepository = vi.mocked(connectorRepository);
const mockedSalesService = vi.mocked(salesService);
const mockedAnalyticsService = vi.mocked(analyticsService);
const mockedFetchMeliOrder = vi.mocked(fetchMercadoLivreOrder);
const mockedResolveMeliOrderId = vi.mocked(resolveMercadoLivreNotificationOrderId);
const mockedFetchMpPayment = vi.mocked(fetchMercadoPagoPayment);

function connectorEvent(overrides: Partial<ConnectorEvent> = {}): ConnectorEvent {
  return {
    id: "evt_1",
    organizationId: "org_1",
    connectorId: "conn_1",
    provider: "MERCADOLIVRE",
    externalEventId: "meli:evt-1",
    topic: "orders",
    payload: { resource: "/orders/123456789", user_id: "12345" },
    processedAt: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  } as ConnectorEvent;
}

function fakeSale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: "sale_1",
    reference: "ref_1",
    quantity: 1,
    amountCents: 10_000,
    currency: "BRL",
    status: "PAID",
    occurredAt: new Date("2026-10-01T10:00:00.000Z"),
    channel: "MERCADOLIVRE",
    externalOrderId: "123456789",
    organizationId: "org_1",
    productId: null,
    creatorId: null,
    campaignId: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  } as Sale;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isSaleIngestionEvent — the (provider, topic) gate", () => {
  it("accepts every enabled Mercado Livre DevCenter topic", () => {
    for (const topic of ["Payments", "Orders_v2", "Items", "Shipments"]) {
      expect(isSaleIngestionEvent("MERCADOLIVRE", topic)).toBe(true);
    }
    expect(isSaleIngestionEvent("MERCADOLIVRE", "orders")).toBe(true);
  });

  it("accepts the Mercado Pago payment topic", () => {
    expect(isSaleIngestionEvent("MERCADOPAGO", "payment")).toBe(true);
  });

  it("rejects unsupported topics and other providers", () => {
    expect(isSaleIngestionEvent("MERCADOLIVRE", "questions")).toBe(false);
    expect(isSaleIngestionEvent("MERCADOPAGO", "merchant_order")).toBe(false);
    expect(isSaleIngestionEvent("SHOPEE", "orders")).toBe(false);
    expect(isSaleIngestionEvent("MERCADOLIVRE", null)).toBe(false);
  });
});

describe("provider status mappers", () => {
  it("maps Meli order statuses onto the Sale lifecycle", () => {
    expect(meliOrderStatusToSaleStatus("paid")).toBe("PAID");
    expect(meliOrderStatusToSaleStatus("shipped")).toBe("PAID");
    expect(meliOrderStatusToSaleStatus("delivered")).toBe("PAID");
    expect(meliOrderStatusToSaleStatus("cancelled")).toBe("CANCELLED");
    expect(meliOrderStatusToSaleStatus("payment_in_process")).toBe("PENDING");
  });

  it("maps Mercado Pago payment statuses onto the Sale lifecycle", () => {
    expect(mercadoPagoStatusToSaleStatus("approved")).toBe("PAID");
    expect(mercadoPagoStatusToSaleStatus("refunded")).toBe("REFUNDED");
    expect(mercadoPagoStatusToSaleStatus("charged_back")).toBe("REFUNDED");
    expect(mercadoPagoStatusToSaleStatus("cancelled")).toBe("CANCELLED");
    expect(mercadoPagoStatusToSaleStatus("pending")).toBe("PENDING");
    expect(mercadoPagoStatusToSaleStatus("rejected")).toBe("PENDING");
  });
});

describe("processSaleIngestionEvent", () => {
  it("ingests a PAID Mercado Livre order end-to-end", async () => {
    mockedRepository.findEvent.mockResolvedValue(connectorEvent());
    mockedFetchMeliOrder.mockResolvedValue({
      id: "123456789",
      status: "paid",
      totalAmountCents: 18_990,
      currencyId: "BRL",
      dateCreated: new Date("2026-10-01T09:30:00.000Z"),
      dateClosed: new Date("2026-10-01T09:35:00.000Z"),
      buyerNickname: "buyer",
      itemCount: 2,
    });
    mockedSalesService.upsertIngestedSale.mockResolvedValue({
      sale: fakeSale({ id: "sale_1" }),
      outcome: "created",
    });

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:evt-1",
    });

    expect(result).toMatchObject({ status: "processed", outcome: "created", saleId: "sale_1" });
    expect(mockedFetchMeliOrder).toHaveBeenCalledWith("token", "123456789");
    expect(mockedSalesService.upsertIngestedSale).toHaveBeenCalledWith("org_1", {
      channel: "MERCADOLIVRE",
      externalOrderId: "123456789",
      amountCents: 18_990,
      currency: "BRL",
      status: "PAID",
      quantity: 2,
      occurredAt: new Date("2026-10-01T09:35:00.000Z"),
    });
    expect(mockedRepository.incrementIngestionCounters).toHaveBeenCalledWith(
      "org_1",
      "MERCADOLIVRE",
      { imported: 1, duplicates: 0, failed: 0 },
    );
    expect(mockedFrameworkRepository.recordIngestionCounters).toHaveBeenCalledWith(
      "org_1",
      "MERCADOLIVRE",
      { imported: 1, duplicates: 0, failed: 0 },
    );
    expect(mockedAnalyticsService.refreshForSale).toHaveBeenCalledWith(
      "org_1",
      new Date("2026-10-01T10:00:00.000Z"),
    );
    expect(mockedRepository.markEventProcessed).toHaveBeenCalledWith(
      "org_1",
      "MERCADOLIVRE",
      "meli:evt-1",
    );
  });

  it.each([
    ["payments", "/payments/987", "meli:payment-1"],
    ["shipments", "/shipments/654", "meli:shipment-1"],
  ])(
    "resolves a Meli %s event back to its order before upserting",
    async (topic, resource, externalEventId) => {
      mockedRepository.findEvent.mockResolvedValue(
        connectorEvent({ topic, externalEventId, payload: { topic, resource, user_id: "12345" } }),
      );
      mockedResolveMeliOrderId.mockResolvedValueOnce("123456789");
      mockedFetchMeliOrder.mockResolvedValue({
        id: "123456789",
        status: "paid",
        totalAmountCents: 18_990,
        currencyId: "BRL",
        dateCreated: new Date("2026-10-01T09:30:00.000Z"),
        dateClosed: new Date("2026-10-01T09:35:00.000Z"),
        buyerNickname: null,
        itemCount: 2,
      });
      mockedSalesService.upsertIngestedSale.mockResolvedValue({
        sale: fakeSale(),
        outcome: "unchanged",
      });

      const result = await processSaleIngestionEvent({
        organizationId: "org_1",
        provider: "MERCADOLIVRE",
        externalEventId,
      });

      expect(mockedResolveMeliOrderId).toHaveBeenCalledWith("token", topic, resource);
      expect(mockedFetchMeliOrder).toHaveBeenCalledWith("token", "123456789");
      expect(result).toMatchObject({ status: "processed", outcome: "unchanged" });
    },
  );

  it("consumes an Items event without fabricating a Sale", async () => {
    mockedRepository.findEvent.mockResolvedValue(
      connectorEvent({
        topic: "items",
        externalEventId: "meli:item-1",
        payload: { topic: "items", resource: "/items/MLB123", user_id: "12345" },
      }),
    );
    mockedResolveMeliOrderId.mockResolvedValueOnce(null);

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:item-1",
    });

    expect(result.status).toBe("skipped");
    expect(mockedSalesService.upsertIngestedSale).not.toHaveBeenCalled();
    expect(mockedRepository.markEventProcessed).toHaveBeenCalledWith(
      "org_1",
      "MERCADOLIVRE",
      "meli:item-1",
    );
  });

  it("ingests an approved Mercado Pago payment with the tenant channel", async () => {
    mockedRepository.findEvent.mockResolvedValue(
      connectorEvent({
        provider: "MERCADOPAGO",
        externalEventId: "mp:evt-9",
        topic: "payment",
        payload: { id: "evt-9", type: "payment", user_id: "777", data: { id: "pay-001" } },
      }),
    );
    mockedFetchMpPayment.mockResolvedValue({
      id: "pay-001",
      status: "approved",
      statusDetail: "accredited",
      amountCents: 25_000,
      currencyId: "BRL",
      dateCreated: new Date("2026-10-01T11:00:00.000Z"),
      dateApproved: new Date("2026-10-01T11:00:05.000Z"),
      externalOrderId: "pay-001",
      payerEmail: null,
    });
    mockedSalesService.upsertIngestedSale.mockResolvedValue({
      sale: fakeSale({ id: "sale_2" }),
      outcome: "created",
    });

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOPAGO",
      externalEventId: "mp:evt-9",
    });

    expect(result).toMatchObject({ status: "processed", outcome: "created" });
    expect(mockedFetchMpPayment).toHaveBeenCalledWith("token", "pay-001");
    expect(mockedSalesService.upsertIngestedSale).toHaveBeenCalledWith("org_1", {
      channel: "MERCADOPAGO",
      externalOrderId: "pay-001",
      amountCents: 25_000,
      currency: "BRL",
      status: "PAID",
      quantity: 1,
      occurredAt: new Date("2026-10-01T11:00:05.000Z"),
    });
  });

  it("replays are terminal: a processed event is never re-fetched", async () => {
    mockedRepository.findEvent.mockResolvedValue(
      connectorEvent({ processedAt: new Date("2026-10-01T10:05:00.000Z") }),
    );

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:evt-1",
    });

    expect(result.status).toBe("duplicate");
    expect(mockedFetchMeliOrder).not.toHaveBeenCalled();
    expect(mockedSalesService.upsertIngestedSale).not.toHaveBeenCalled();
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("a pending Mercado Pago payment is terminal-ignored until it settles", async () => {
    mockedRepository.findEvent.mockResolvedValue(
      connectorEvent({
        provider: "MERCADOPAGO",
        externalEventId: "mp:evt-10",
        topic: "payment",
        payload: { data: { id: "pay-002" } },
      }),
    );
    mockedFetchMpPayment.mockResolvedValue({
      id: "pay-002",
      status: "pending",
      statusDetail: "pending_contingency",
      amountCents: 9_900,
      currencyId: "BRL",
      dateCreated: new Date(),
      dateApproved: null,
      externalOrderId: "pay-002",
      payerEmail: null,
    });
    mockedSalesService.upsertIngestedSale.mockResolvedValue({
      sale: null,
      outcome: "ignored",
    });

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOPAGO",
      externalEventId: "mp:evt-10",
    });

    expect(result.status).toBe("ignored");
    expect(mockedSalesService.upsertIngestedSale).toHaveBeenCalled();
    expect(mockedRepository.incrementIngestionCounters).not.toHaveBeenCalled();
    expect(mockedRepository.markEventProcessed).toHaveBeenCalled();
  });

  it("an unresolvable delivery (no durable row) is skipped", async () => {
    mockedRepository.findEvent.mockResolvedValue(null);

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:missing",
    });

    expect(result.status).toBe("skipped");
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });

  it("a payload without a fetchable resource id is terminally skipped", async () => {
    mockedRepository.findEvent.mockResolvedValue(
      connectorEvent({ payload: { topic: "orders", resource: null } }),
    );

    const result = await processSaleIngestionEvent({
      organizationId: "org_1",
      provider: "MERCADOLIVRE",
      externalEventId: "meli:evt-1",
    });

    expect(result.status).toBe("skipped");
    expect(mockedFetchMeliOrder).not.toHaveBeenCalled();
    expect(mockedRepository.markEventProcessed).toHaveBeenCalled();
  });

  it("propagates transient provider failures so BullMQ retries", async () => {
    mockedRepository.findEvent.mockResolvedValue(connectorEvent());
    mockedFetchMeliOrder.mockRejectedValue(new Error("provider 5xx"));

    await expect(
      processSaleIngestionEvent({
        organizationId: "org_1",
        provider: "MERCADOLIVRE",
        externalEventId: "meli:evt-1",
      }),
    ).rejects.toThrow("provider 5xx");
    expect(mockedRepository.markEventProcessed).not.toHaveBeenCalled();
  });
});
