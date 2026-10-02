import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorProvider, Prisma } from "@prisma/client";
import { verifyTikTokWebhookSignature } from "@/modules/connectors/tiktok/webhooks/verifier";
import { enqueueSaleIngestion } from "@/lib/async/queue";
import { log } from "@/lib/observability/logger";
import { marketplaceRepository } from "../core/connector.repository";
import { WebhookSignatureError } from "../core/errors";
import { verifyShopeeWebhookSignature } from "../shopee/shopee.service";
import { verifyNuvemshopWebhookSignature } from "@/modules/connectors/nuvemshop/nuvemshop.service";
import { verifyMercadoPagoWebhookSignature } from "../mercadopago/mercadopago.service";
import { isSaleIngestionEvent } from "../ingestion/sale-ingestion.service";

/**
 * Unified provider webhook handlers (PR012) — verification, normalization
 * and idempotent ingestion for the six real integrations.
 *
 * Every handler follows the same contract:
 *   1. VERIFY the provider signature over the exact raw bytes (a forged
 *      event can never reach the database);
 *   2. NORMALIZE the payload onto `ParsedWebhookEvent` (dedupe id, topic,
 *      tenant-resolution hint);
 *   3. RESOLVE the tenant through the stored provider identity (never
 *      through caller input);
 *   4. INGEST idempotently into `ConnectorEvent` — at-least-once provider
 *      deliveries are processed exactly once.
 */

export interface ParsedWebhookEvent {
  externalEventId: string;
  topic: string | null;
  /** Provider-side identity used to resolve the tenant (shop/user/account id). */
  shopId: string | null;
  payload: Record<string, unknown>;
}

export interface WebhookIngestResult {
  received: true;
  /** `ignored` = no tenant owns the provider identity (unknown shop). */
  ignored?: boolean;
  /** `duplicate` = the delivery key was already ingested (at-least-once replay). */
  duplicate?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function safeEqualHex(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ------------------------------------------------------------------
// Per-provider verification + normalization
// ------------------------------------------------------------------

/** TikTok Shop: HMAC-SHA256(appSecret, appKey + rawBody) in `authorization`. */
function parseTikTokEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  const verified = verifyTikTokWebhookSignature({
    rawBody,
    signature: request.headers.get("authorization"),
  });
  if (!verified) throw new WebhookSignatureError("TIKTOK");
  const body = asRecord(JSON.parse(rawBody));
  const type = typeof body.type === "string" ? body.type : "unknown";
  const shopId = body.shop_id !== undefined ? String(body.shop_id) : null;
  const timestamp = body.timestamp !== undefined ? String(body.timestamp) : "0";
  return {
    externalEventId: `tiktok:${type}:${shopId ?? "-"}:${timestamp}`,
    topic: type,
    shopId,
    payload: body,
  };
}

/** Meta/Instagram: `x-hub-signature-256: sha256=<hmac>` over the raw bytes. */
function parseInstagramEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  const appSecret = process.env.META_APP_SECRET?.trim();
  const header = request.headers.get("x-hub-signature-256") ?? "";
  const received = header.startsWith("sha256=") ? header.slice("sha256=".length) : "";
  if (!appSecret || !received) throw new WebhookSignatureError("INSTAGRAM");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  if (!safeEqualHex(received, expected)) throw new WebhookSignatureError("INSTAGRAM");

  const body = asRecord(JSON.parse(rawBody));
  const entries = Array.isArray(body.entry) ? body.entry : [];
  const firstEntry = asRecord(entries[0]);
  const changes = Array.isArray(firstEntry.changes) ? firstEntry.changes : [];
  const firstChange = asRecord(changes[0]);
  const field = typeof firstChange.field === "string" ? firstChange.field : "unknown";
  const entryId = firstEntry.id !== undefined ? String(firstEntry.id) : null;
  const time = firstEntry.time !== undefined ? String(firstEntry.time) : "0";
  return {
    externalEventId: `instagram:${entryId ?? "-"}:${field}:${time}`,
    topic: field,
    shopId: entryId,
    payload: body,
  };
}

/** Shopee push: HMAC-SHA256(partner_key, webhook_url + raw_body) in `authorization`. */
function parseShopeeEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  const webhookUrl = new URL(request.url).toString();
  if (!verifyShopeeWebhookSignature(rawBody, webhookUrl, request.headers.get("authorization"))) {
    throw new WebhookSignatureError("SHOPEE");
  }
  const body = asRecord(JSON.parse(rawBody));
  const code = body.code !== undefined ? String(body.code) : "unknown";
  const shopId = body.shop_id !== undefined ? String(body.shop_id) : null;
  const timestamp = body.timestamp !== undefined ? String(body.timestamp) : "0";
  return {
    externalEventId: `shopee:${code}:${shopId ?? "-"}:${timestamp}`,
    topic: code,
    shopId,
    payload: body,
  };
}

/** Nuvemshop: base64 HMAC-SHA256(app secret, raw request body). */
function parseNuvemshopEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  if (!verifyNuvemshopWebhookSignature(rawBody, request.headers.get("x-linkedstore-hmac-sha256"))) {
    throw new WebhookSignatureError("NUVEMSHOP");
  }
  const body = asRecord(JSON.parse(rawBody));
  const topic = typeof body.event === "string" ? body.event.trim().toLowerCase() : "unknown";
  const storeId = body.store_id !== undefined ? String(body.store_id) : null;
  const resourceId = body.id !== undefined ? String(body.id) : "unknown";
  return {
    // Nuvemshop sends no delivery id. A store/topic/resource tuple is stable
    // across at-least-once retries, while distinct lifecycle topics still
    // process the same order as it moves from created → paid/cancelled.
    externalEventId: `nuvemshop:${storeId ?? "-"}:${topic}:${resourceId}`,
    topic,
    shopId: storeId,
    payload: body,
  };
}

/**
 * Mercado Livre notifications carry no HMAC; integrity is enforced by an
 * optional shared secret appended to the registered notification URL
 * (`?secret=…`). When MERCADOLIVRE_WEBHOOK_SECRET is set, a missing/wrong
 * secret rejects the delivery.
 */
function parseMercadoLivreEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  const secret = process.env.MERCADOLIVRE_WEBHOOK_SECRET?.trim();
  if (secret) {
    const presented = new URL(request.url).searchParams.get("secret") ?? "";
    if (!presented || !safeEqualHex(presented, secret)) {
      throw new WebhookSignatureError("MERCADOLIVRE");
    }
  }
  const body = asRecord(JSON.parse(rawBody));
  const topic = typeof body.topic === "string" ? body.topic.trim().toLowerCase() : "unknown";
  const userId = body.user_id !== undefined ? String(body.user_id) : null;
  const id = typeof body._id === "string" ? body._id : `${topic}:${String(body.resource ?? "-")}`;
  return {
    externalEventId: `meli:${id}`,
    topic,
    shopId: userId,
    payload: body,
  };
}

/** Mercado Pago: `x-signature` manifest HMAC (see mercadopago.service.ts). */
function parseMercadoPagoEvent(request: Request, rawBody: string): ParsedWebhookEvent {
  const body = asRecord(JSON.parse(rawBody));
  const data = asRecord(body.data);
  const dataId = data.id !== undefined ? String(data.id) : "";
  const verified = verifyMercadoPagoWebhookSignature({
    dataId,
    xSignature: request.headers.get("x-signature"),
    xRequestId: request.headers.get("x-request-id"),
  });
  if (!verified) throw new WebhookSignatureError("MERCADOPAGO");
  const type = typeof body.type === "string" ? body.type : "unknown";
  const id =
    body.id !== undefined
      ? String(body.id)
      : `${type}:${dataId}:${String(body.date_created ?? "-")}`;
  const userId = body.user_id !== undefined ? String(body.user_id) : null;
  return {
    externalEventId: `mp:${id}`,
    topic: type,
    shopId: userId,
    payload: body,
  };
}

const PARSERS: Record<
  ConnectorProvider,
  (request: Request, rawBody: string) => ParsedWebhookEvent
> = {
  TIKTOK: parseTikTokEvent,
  INSTAGRAM: parseInstagramEvent,
  SHOPEE: parseShopeeEvent,
  NUVEMSHOP: parseNuvemshopEvent,
  MERCADOLIVRE: parseMercadoLivreEvent,
  MERCADOPAGO: parseMercadoPagoEvent,
};

// ------------------------------------------------------------------
// Ingestion
// ------------------------------------------------------------------

/**
 * Verify, normalize and ingest one provider webhook. NEVER throws provider
 * payloads; only `WebhookSignatureError` propagates (mapped to 401 by the
 * route handler).
 *
 * Sale-relevant deliveries (PR014) are enqueued to the BullMQ worker
 * instead of being stamped processed — `processedAt` is only written by the
 * ingestion worker once the `Sale` upsert reaches a terminal outcome.
 */
export async function handleProviderWebhook(
  provider: ConnectorProvider,
  request: Request,
  rawBody: string,
): Promise<WebhookIngestResult> {
  const parse = PARSERS[provider];
  if (!parse) throw new WebhookSignatureError(provider);

  const event = parse(request, rawBody);

  // Tenant resolution: the stored provider identity is the ONLY trusted
  // link between an inbound event and a workspace.
  if (!event.shopId) return { received: true, ignored: true };
  const connector = await marketplaceRepository.findByShopId(provider, event.shopId);
  if (!connector) return { received: true, ignored: true };
  const organizationId = connector.organizationId;

  const already = await marketplaceRepository.hasEvent(
    organizationId,
    provider,
    event.externalEventId,
  );
  if (already) return { received: true, duplicate: true };

  await marketplaceRepository.recordEvent(organizationId, {
    provider,
    externalEventId: event.externalEventId,
    connectorId: connector.id,
    topic: event.topic,
    payload: event.payload as Prisma.InputJsonValue,
  });

  // Mercado Livre's enabled order/payment/item/shipment deliveries and
  // Mercado Pago payments are handed to BullMQ. The provider always gets a
  // fast 200 once the event is durably stored; Items are acknowledged by the
  // worker without fabricating revenue. Unsupported topics are terminal here.
  if (isSaleIngestionEvent(provider, event.topic)) {
    try {
      await enqueueSaleIngestion({
        organizationId,
        provider,
        externalEventId: event.externalEventId,
      });
    } catch (error) {
      // Redis unavailable: the event is durable in the inbox with
      // processedAt = null — the worker's pending-event scanner re-enqueues
      // it once the infrastructure is back. Never fail the provider.
      log({
        event: "SALE_WEBHOOK_ENQUEUE_DEFERRED",
        level: "error",
        context: { provider, externalEventId: event.externalEventId, error },
      });
    }
    return { received: true };
  }

  await marketplaceRepository.markEventProcessed(organizationId, provider, event.externalEventId);
  return { received: true };
}

/**
 * Meta webhook handshake (GET): echoes `hub.challenge` when the verify
 * token matches META_VERIFY_TOKEN. Used by Instagram Shopping catalog and
 * messaging subscriptions.
 */
export function verifyMetaHandshake(url: URL): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_VERIFY_TOKEN?.trim();
  if (mode !== "subscribe" || !expected || !token || !challenge) return null;
  return safeEqualHex(token, expected) ? challenge : null;
}
