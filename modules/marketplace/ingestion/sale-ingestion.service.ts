import "server-only";

import type { ConnectorProvider } from "@prisma/client";
import { SaleStatus } from "@prisma/client";
import { log } from "@/lib/observability/logger";
import { saleChannelFromConnectorProvider } from "@/modules/sales/sales-channel";
import { salesService } from "@/modules/sales/sales.service";
import { marketplaceRepository } from "../core/connector.repository";
import { marketplaceService } from "../core/connector.service";
import type { ConnectorPlatform } from "@prisma/client";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import {
  fetchMercadoLivreOrder,
  meliOrderStatusToSaleStatus,
} from "../mercadolivre/mercadolivre.service";
import {
  fetchMercadoPagoPayment,
  mercadoPagoStatusToSaleStatus,
} from "../mercadopago/mercadopago.service";

/**
 * Sale ingestion service (PR014 — Motor Financeiro Unificado do Hub
 * Multicanal).
 *
 * Connects the webhook inbox (`ConnectorEvent`) to the financial model
 * (`Sale`) through the BullMQ/Redis worker:
 *
 *   1. a Mercado Livre `orders`/`orders_v2` notification or a Mercado Pago
 *      `payment` notification is ingested (verified + tenant-resolved) by
 *      `modules/marketplace/webhooks/handlers.ts` and enqueued for
 *      background processing;
 *   2. the worker calls `processSaleIngestionEvent()`, which re-reads the
 *      durable event, fetches the authoritative order/payment from the
 *      provider API (with the tenant's credential — transparently refreshed
 *      for Mercado Livre via `MERCADOLIVRE_CLIENT_SECRET`, or the tenant /
 *      `MERCADOPAGO_ACCESS_TOKEN` pair for Mercado Pago) and;
 *   3. performs an IDEMPOTENT upsert on `Sale` over the
 *      `(organizationId, channel, externalOrderId)` unique index — replays
 *      never double-count revenue.
 *
 * Nothing here trusts the webhook payload for money: amounts, currency and
 * status always come from the provider's official API response.
 */

/** Mercado Livre topics that carry order/sale information. */
export const MERCADOLIVRE_SALE_TOPICS = ["orders", "orders_v2"] as const;

/** Mercado Pago notification types that carry payment information. */
export const MERCADOPAGO_SALE_TOPICS = ["payment"] as const;

/** Providers whose webhooks feed the financial engine. */
export const SALE_INGESTION_PROVIDERS: readonly ConnectorProvider[] = [
  "MERCADOLIVRE",
  "MERCADOPAGO",
];

/** Does this (provider, topic) pair carry sale-relevant data? */
export function isSaleIngestionEvent(provider: ConnectorProvider, topic: string | null): boolean {
  if (!topic) return false;
  switch (provider) {
    case "MERCADOLIVRE":
      return (MERCADOLIVRE_SALE_TOPICS as readonly string[]).includes(topic);
    case "MERCADOPAGO":
      return (MERCADOPAGO_SALE_TOPICS as readonly string[]).includes(topic);
    default:
      return false;
  }
}

/**
 * Provider → PR005 framework platform. The enums were designed 1:1 (see
 * `sync.service.ts`), so the mapping is the identity — kept explicit through
 * a type-level cast only.
 */
function toFrameworkPlatform(provider: ConnectorProvider): ConnectorPlatform {
  return provider as ConnectorPlatform;
}

/** Draft of one external sale, resolved from the provider's official API. */
interface IngestedSaleDraft {
  externalOrderId: string;
  amountCents: number;
  currency: string;
  status: SaleStatus;
  quantity: number;
  occurredAt: Date;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** `"/orders/1234567890"` → `"1234567890"`. */
function meliOrderIdFromResource(resource: string): string | null {
  const match = /\/orders\/(\d+)/.exec(resource);
  return match ? (match[1] ?? null) : null;
}

export interface SaleIngestionResult {
  provider: ConnectorProvider;
  externalEventId: string;
  /** How the delivery was handled. */
  status:
    | "processed" /** Sale upserted (created or updated). */
    | "duplicate" /** Event already processed — replay. */
    | "ignored" /** Sale-irrelevant state (pending payment, unknown refund…). */
    | "skipped"; /** No durable event row / no fetchable resource id. */
  outcome?: "created" | "updated" | "unchanged" | "ignored";
  saleId?: string;
  amountCents?: number;
}

async function resolveMercadoLivreDraft(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<IngestedSaleDraft | null> {
  const resource = typeof payload.resource === "string" ? payload.resource : "";
  const orderId = meliOrderIdFromResource(resource);
  if (!orderId) return null;

  const { accessToken } = await marketplaceService.getValidAccessToken(
    organizationId,
    "MERCADOLIVRE",
  );
  const order = await fetchMercadoLivreOrder(accessToken, orderId);

  return {
    externalOrderId: order.id,
    amountCents: order.totalAmountCents,
    currency: order.currencyId,
    status: meliOrderStatusToSaleStatus(order.status) as SaleStatus,
    quantity: order.itemCount,
    occurredAt: order.dateClosed ?? order.dateCreated,
  };
}

async function resolveMercadoPagoDraft(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<IngestedSaleDraft | null> {
  const data = asRecord(payload.data);
  const paymentId = data.id !== undefined ? String(data.id) : "";
  if (!paymentId) return null;

  const { accessToken } = await marketplaceService.getValidAccessToken(
    organizationId,
    "MERCADOPAGO",
  );
  const payment = await fetchMercadoPagoPayment(accessToken, paymentId);

  return {
    externalOrderId: payment.externalOrderId,
    amountCents: payment.amountCents,
    currency: payment.currencyId,
    status: mercadoPagoStatusToSaleStatus(payment.status) as SaleStatus,
    quantity: 1,
    occurredAt: payment.dateApproved ?? payment.dateCreated,
  };
}

/**
 * Process one webhook delivery end-to-end. Safe to call repeatedly: the
 * event is stamped `processedAt` only after a terminal outcome, and the
 * `Sale` upsert is guarded by the tenant-scoped unique index.
 *
 * Throws only for TRANSIENT failures (network, provider 5xx, Redis outage)
 * so the BullMQ job retries with backoff; permanent states are terminal
 * results, never exceptions.
 */
export async function processSaleIngestionEvent(input: {
  organizationId: string;
  provider: ConnectorProvider;
  externalEventId: string;
}): Promise<SaleIngestionResult> {
  const { organizationId, provider, externalEventId } = input;

  const event = await marketplaceRepository.findEvent(organizationId, provider, externalEventId);
  if (!event) {
    return { provider, externalEventId, status: "skipped" };
  }
  if (event.processedAt) {
    return { provider, externalEventId, status: "duplicate" };
  }

  const payload = asRecord(event.payload);
  const draft =
    provider === "MERCADOLIVRE"
      ? await resolveMercadoLivreDraft(organizationId, payload)
      : provider === "MERCADOPAGO"
        ? await resolveMercadoPagoDraft(organizationId, payload)
        : null;

  if (!draft) {
    // No fetchable resource (malformed payload or non-sale topic): terminal,
    // so the delivery never blocks the inbox.
    await marketplaceRepository.markEventProcessed(organizationId, provider, externalEventId);
    return { provider, externalEventId, status: "skipped" };
  }

  if (draft.status !== SaleStatus.PAID) {
    const { sale, outcome } = await salesService.upsertIngestedSale(organizationId, {
      channel: saleChannelFromConnectorProvider(provider),
      externalOrderId: draft.externalOrderId,
      amountCents: draft.amountCents,
      currency: draft.currency,
      status: draft.status,
      quantity: draft.quantity,
      occurredAt: draft.occurredAt,
    });
    // A pending payment settles through a LATER notification (its own event
    // id); a refund for an unknown order has nothing to update. Terminal.
    await marketplaceRepository.markEventProcessed(organizationId, provider, externalEventId);
    return {
      provider,
      externalEventId,
      status: outcome === "updated" ? "processed" : "ignored",
      outcome,
      saleId: sale?.id,
    };
  }

  const { sale, outcome } = await salesService.upsertIngestedSale(organizationId, {
    channel: saleChannelFromConnectorProvider(provider),
    externalOrderId: draft.externalOrderId,
    amountCents: draft.amountCents,
    currency: draft.currency,
    status: SaleStatus.PAID,
    quantity: draft.quantity,
    occurredAt: draft.occurredAt,
  });

  // Consolidate the counters on BOTH stores (unified Connector row and the
  // PR005 ConnectorStatus row) — same convention as a sync run, minus the
  // sync-run semantics (no syncCount, no lastSyncAt stamp).
  const counters =
    outcome === "created" || outcome === "updated"
      ? { imported: 1, duplicates: 0, failed: 0 }
      : { imported: 0, duplicates: 1, failed: 0 };
  await Promise.all([
    marketplaceRepository.incrementIngestionCounters(organizationId, provider, counters),
    connectorRepository.recordIngestionCounters(organizationId, toFrameworkPlatform(provider), {
      imported: counters.imported,
      duplicates: counters.duplicates,
      failed: counters.failed,
    }),
  ]);

  await marketplaceRepository.markEventProcessed(organizationId, provider, externalEventId);

  log({
    event: "SALE_INGESTED",
    level: "info",
    context: {
      provider,
      externalEventId,
      externalOrderId: draft.externalOrderId,
      amountCents: draft.amountCents,
      outcome,
      saleId: sale?.id ?? null,
    },
  });

  return {
    provider,
    externalEventId,
    status: "processed",
    outcome,
    saleId: sale?.id ?? undefined,
    amountCents: draft.amountCents,
  };
}
