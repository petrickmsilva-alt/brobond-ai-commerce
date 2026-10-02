import "server-only";

import type { ConnectorProvider } from "@prisma/client";
import { SaleStatus } from "@prisma/client";
import { log } from "@/lib/observability/logger";
import { saleChannelFromConnectorProvider } from "@/modules/sales/sales-channel";
import { salesService } from "@/modules/sales/sales.service";
import { marketplaceRepository } from "../core/connector.repository";
import { marketplaceService } from "../core/connector.service";
import { requiresReauthentication } from "../core/errors";
import type { ConnectorPlatform } from "@prisma/client";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import { analyticsService } from "@/modules/analytics/services/analytics.service";
import {
  fetchMercadoLivreOrder,
  meliOrderStatusToSaleStatus,
  resolveMercadoLivreNotificationOrderId,
} from "../mercadolivre/mercadolivre.service";
import {
  fetchMercadoPagoPayment,
  mercadoPagoStatusToSaleStatus,
} from "../mercadopago/mercadopago.service";
import { fetchNuvemshopOrder } from "@/modules/connectors/nuvemshop/nuvemshop.service";

/**
 * Sale ingestion service (PR014 — Motor Financeiro Unificado do Hub
 * Multicanal).
 *
 * Connects the webhook inbox (`ConnectorEvent`) to the financial model
 * (`Sale`) through the BullMQ/Redis worker:
 *
 *   1. a Mercado Livre `orders_v2`, `payments`, `items` or `shipments`
 *      notification (plus legacy `orders`) or a Mercado Pago `payment`
 *      notification is ingested (verified + tenant-resolved) by
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

/**
 * Mercado Livre DevCenter topics handled asynchronously. Payments and
 * shipments are resolved back to their canonical order; items are consumed
 * and acknowledged by the worker but never fabricate a Sale.
 */
export const MERCADOLIVRE_SALE_TOPICS = [
  "orders",
  "orders_v2",
  "payments",
  "shipments",
  "items",
] as const;

/** Mercado Pago notification types that carry payment information. */
export const MERCADOPAGO_SALE_TOPICS = ["payment"] as const;

/** Nuvemshop order lifecycle topics registered during OAuth installation. */
export const NUVEMSHOP_SALE_TOPICS = [
  "order/created",
  "order/paid",
  "order/updated",
  "order/cancelled",
] as const;

/** Providers whose webhooks feed the financial engine. */
export const SALE_INGESTION_PROVIDERS: readonly ConnectorProvider[] = [
  "MERCADOLIVRE",
  "MERCADOPAGO",
  "NUVEMSHOP",
];

/** Does this (provider, topic) pair carry sale-relevant data? */
export function isSaleIngestionEvent(provider: ConnectorProvider, topic: string | null): boolean {
  if (!topic) return false;
  const normalizedTopic = topic.trim().toLowerCase();
  switch (provider) {
    case "MERCADOLIVRE":
      return (MERCADOLIVRE_SALE_TOPICS as readonly string[]).includes(normalizedTopic);
    case "MERCADOPAGO":
      return (MERCADOPAGO_SALE_TOPICS as readonly string[]).includes(normalizedTopic);
    case "NUVEMSHOP":
      return (NUVEMSHOP_SALE_TOPICS as readonly string[]).includes(normalizedTopic);
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
  topic: string | null,
  payload: Record<string, unknown>,
): Promise<IngestedSaleDraft | null> {
  const resource = typeof payload.resource === "string" ? payload.resource : "";
  if (!topic || !resource) return null;

  const { accessToken } = await marketplaceService.getValidAccessToken(
    organizationId,
    "MERCADOLIVRE",
  );
  const orderId = await resolveMercadoLivreNotificationOrderId(accessToken, topic, resource);
  if (!orderId) return null;
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

async function resolveNuvemshopDraft(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<IngestedSaleDraft | null> {
  const orderId = payload.id !== undefined ? String(payload.id) : "";
  const payloadStoreId = payload.store_id !== undefined ? String(payload.store_id) : "";
  if (!orderId) return null;

  const { accessToken, shopId } = await marketplaceService.getValidAccessToken(
    organizationId,
    "NUVEMSHOP",
  );
  // The worker trusts the store identity persisted during OAuth, never a
  // caller-selected tenant/store. A mismatched payload is terminally ignored.
  if (!shopId || (payloadStoreId && payloadStoreId !== shopId)) return null;
  const order = await fetchNuvemshopOrder(accessToken, shopId, orderId);
  return {
    externalOrderId: order.id,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    quantity: order.quantity,
    occurredAt: order.occurredAt,
  };
}

async function recordSaleIngestionCounters(
  organizationId: string,
  provider: ConnectorProvider,
  outcome: "created" | "updated" | "unchanged" | "ignored",
): Promise<void> {
  if (outcome === "ignored") return;
  const counters =
    outcome === "created" || outcome === "updated"
      ? { imported: 1, duplicates: 0, failed: 0 }
      : { imported: 0, duplicates: 1, failed: 0 };
  await Promise.all([
    marketplaceRepository.incrementIngestionCounters(organizationId, provider, {
      imported: counters.imported,
      duplicated: counters.duplicates,
      failed: counters.failed,
    }),
    connectorRepository.recordIngestionCounters(organizationId, toFrameworkPlatform(provider), {
      imported: counters.imported,
      duplicates: counters.duplicates,
      failed: counters.failed,
    }),
  ]);
}

async function refreshAnalyticsAfterSale(
  organizationId: string,
  sale: { occurredAt: Date } | null,
  outcome: "created" | "updated" | "unchanged" | "ignored",
): Promise<void> {
  if (!sale || (outcome !== "created" && outcome !== "updated")) return;
  try {
    const refreshedSnapshots = await analyticsService.refreshForSale(
      organizationId,
      sale.occurredAt,
    );
    log({
      event: "SALE_ANALYTICS_REFRESHED",
      level: "info",
      context: { organizationId, refreshedSnapshots },
    });
  } catch (error) {
    // Sale ingestion remains durable even if analytics recomputation has a
    // transient failure. `getDashboard()` also detects stale snapshots from
    // Sale.updatedAt and repairs them on the next Hub read.
    log({
      event: "SALE_ANALYTICS_REFRESH_DEFERRED",
      level: "error",
      context: {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
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
  let draft: IngestedSaleDraft | null;
  try {
    draft =
      provider === "MERCADOLIVRE"
        ? await resolveMercadoLivreDraft(organizationId, event.topic, payload)
        : provider === "MERCADOPAGO"
          ? await resolveMercadoPagoDraft(organizationId, payload)
          : provider === "NUVEMSHOP"
            ? await resolveNuvemshopDraft(organizationId, payload)
            : null;
  } catch (error) {
    if (requiresReauthentication(error)) {
      // PR016.2 crypto catch on the financial flow: the channel's stored
      // credential can no longer be opened (e.g. the Mercado Pago token was
      // saved BEFORE a CONNECTOR_ENCRYPTION_KEY rotation —
      // `getValidAccessToken()` already parked the channel in
      // REAUTH_REQUIRED). Nothing in this worker can fix that, and it must
      // NEVER crash the server: the delivery stays pending in the inbox
      // (`processedAt` remains null), so the pending-event scanner retries
      // it once the operator reconnects the account and a fresh token is
      // re-encrypted with the current key.
      log({
        event: "SALE_INGESTION_DEFERRED_REAUTH_REQUIRED",
        level: "warn",
        context: {
          organizationId,
          provider,
          externalEventId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return { provider, externalEventId, status: "skipped" };
    }
    throw error;
  }

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
      // Nuvemshop emits a canonical order/created event. Persist that first
      // PENDING state so every incoming sale is represented before payment.
      createPending: provider === "NUVEMSHOP",
    });
    // A pending payment settles through a LATER notification (its own event
    // id); a refund for an unknown order has nothing to update. Terminal.
    await refreshAnalyticsAfterSale(organizationId, sale, outcome);
    if (provider === "NUVEMSHOP") {
      await recordSaleIngestionCounters(organizationId, provider, outcome);
    }
    await marketplaceRepository.markEventProcessed(organizationId, provider, externalEventId);
    return {
      provider,
      externalEventId,
      status: outcome === "created" || outcome === "updated" ? "processed" : "ignored",
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

  await refreshAnalyticsAfterSale(organizationId, sale, outcome);

  // Consolidate the counters on BOTH stores (unified Connector row and the
  // PR005 ConnectorStatus row) — same convention as a sync run, minus the
  // sync-run semantics (no syncCount, no lastSyncAt stamp).
  await recordSaleIngestionCounters(organizationId, provider, outcome);

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
