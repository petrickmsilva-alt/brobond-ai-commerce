import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { ConnectorConfigError, ProviderApiError, WebhookSignatureError } from "../core/errors";
import type { NormalizedContent } from "@/modules/connectors/core/connector.interface";

/**
 * Mercado Pago (PR012) — official API credentials, server-side ONLY.
 *
 * Unlike the OAuth2 marketplaces, Mercado Pago integrates with production
 * API keys issued per seller account (Access Token + Public Key). The
 * Access Token is validated against `/users/me` before being persisted
 * (encrypted) on the unified Connector model; the Public Key feeds the
 * checkout billing flow and is only ever exposed as a masked preview.
 */

const MP_API_BASE_URL = "https://api.mercadopago.com";
const PROVIDER = "MERCADOPAGO" as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConnectorConfigError(name, PROVIDER);
  return value;
}

function apiBaseUrl(): string {
  return process.env.MERCADOPAGO_API_BASE_URL?.trim() || MP_API_BASE_URL;
}

export interface MercadoPagoIdentity {
  userId: string;
  nickname: string | null;
  email: string | null;
  siteId: string | null;
}

interface MpUserResponse {
  id?: number;
  nickname?: string;
  email?: string;
  site_id?: string;
  message?: string;
}

/**
 * Validate a production Access Token against the official API and return
 * the seller identity. Rejects invalid/revoked tokens — a credential is
 * never persisted without passing this check.
 */
export async function validateMercadoPagoAccessToken(
  accessToken: string,
): Promise<MercadoPagoIdentity> {
  let response: Response;
  try {
    response = await fetch(new URL("/users/me", apiBaseUrl()), {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Pago.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as MpUserResponse | undefined;
  if (!response.ok || payload?.id === undefined) {
    throw new ProviderApiError(
      "O Access Token do Mercado Pago é inválido ou foi revogado.",
      response.status || 401,
      PROVIDER,
    );
  }
  return {
    userId: String(payload.id),
    nickname: payload.nickname ?? null,
    email: payload.email ?? null,
    siteId: payload.site_id ?? null,
  };
}

interface MpPaymentsSearchResponse {
  results?: Array<{
    id?: number;
    status?: string;
    status_detail?: string;
    transaction_amount?: number;
    currency_id?: string;
    description?: string;
    date_created?: string;
    payer?: { email?: string };
  }>;
  paging?: { total?: number };
}

/**
 * Fetch recent checkout payments (billing feed), normalized onto the
 * connector framework contract. Approved payments import as PRODUCT
 * records of the billing stream; other statuses still import so the
 * dashboard reflects the real funnel.
 */
export async function fetchMercadoPagoPayments(
  accessToken: string,
  limit: number,
): Promise<NormalizedContent[]> {
  const url = new URL("/v1/payments/search", apiBaseUrl());
  url.searchParams.set("sort", "date_created");
  url.searchParams.set("criteria", "desc");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Pago.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as
    (MpPaymentsSearchResponse & { message?: string }) | undefined;
  if (!response.ok) {
    throw new ProviderApiError(
      payload?.message || "Não foi possível consultar os pagamentos do Mercado Pago.",
      response.status || 502,
      PROVIDER,
    );
  }

  return (payload?.results ?? [])
    .filter((payment) => payment.id !== undefined)
    .map((payment) => ({
      externalId: `mp:payment:${payment.id}`,
      type: "POST" as const,
      title:
        payment.description?.trim() ||
        `Pagamento ${payment.id} — ${payment.status ?? "desconhecido"}`,
      caption: `Status: ${payment.status ?? "?"} · ${payment.transaction_amount ?? 0} ${
        payment.currency_id ?? "BRL"
      }`,
      publishedAt: payment.date_created ? new Date(payment.date_created) : undefined,
      raw: {
        provider: "mercadopago",
        paymentId: payment.id,
        status: payment.status,
        statusDetail: payment.status_detail,
        amount: payment.transaction_amount,
        currency: payment.currency_id,
      },
    }));
}

// ------------------------------------------------------------------
// Single payment — webhook sale ingestion (PR014 — Motor Financeiro)
// ------------------------------------------------------------------

/** Parse a decimal amount into integer cents, clamping malformed input. */
function toAmountCents(amount: number | null | undefined): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

export interface MercadoPagoPayment {
  id: string;
  /** approved · pending · in_process · rejected · refunded · charged_back · cancelled · in_mediation */
  status: string;
  statusDetail: string | null;
  amountCents: number;
  currencyId: string;
  dateCreated: Date;
  dateApproved: Date | null;
  /** External order reference reported by Mercado Pago (`order.id`), if any. */
  externalOrderId: string;
  payerEmail: string | null;
}

interface MpPaymentResponse {
  id?: number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  transaction_amount_refunded?: number;
  currency_id?: string;
  date_created?: string;
  date_approved?: string | null;
  order?: { id?: string | number; type?: string };
  payer?: { email?: string };
  message?: string;
}

/**
 * Fetch one payment by id (`GET /v1/payments/{id}`) — the `data.id`
 * referenced by `payment` webhook notifications. The access token must
 * belong to the collector account (tenant credential or the protected
 * environment pair).
 */
export async function fetchMercadoPagoPayment(
  accessToken: string,
  paymentId: string,
): Promise<MercadoPagoPayment> {
  let response: Response;
  try {
    response = await fetch(new URL(`/v1/payments/${encodeURIComponent(paymentId)}`, apiBaseUrl()), {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
  } catch {
    throw new ProviderApiError("Falha de rede ao contatar o Mercado Pago.", 503, PROVIDER);
  }
  const payload = (await response.json().catch(() => undefined)) as MpPaymentResponse | undefined;
  if (!response.ok || payload?.id === undefined) {
    throw new ProviderApiError(
      payload?.message || `Não foi possível obter o pagamento ${paymentId} do Mercado Pago.`,
      response.status || 502,
      PROVIDER,
    );
  }

  return {
    id: String(payload.id),
    status: payload.status ?? "unknown",
    statusDetail: payload.status_detail ?? null,
    amountCents: toAmountCents(payload.transaction_amount),
    currencyId: payload.currency_id ?? "BRL",
    dateCreated: payload.date_created ? new Date(payload.date_created) : new Date(),
    dateApproved: payload.date_approved ? new Date(payload.date_approved) : null,
    externalOrderId:
      payload.order?.id !== undefined ? String(payload.order.id) : String(payload.id),
    payerEmail: payload.payer?.email ?? null,
  };
}

/** Map a Mercado Pago payment status onto the `Sale` lifecycle. */
export function mercadoPagoStatusToSaleStatus(
  status: string,
): "PAID" | "PENDING" | "REFUNDED" | "CANCELLED" {
  switch (status) {
    case "approved":
      return "PAID";
    case "refunded":
    case "charged_back":
      return "REFUNDED";
    case "cancelled":
      return "CANCELLED";
    default:
      // pending · in_process · in_mediation · rejected · …
      return "PENDING";
  }
}

/**
 * Official Mercado Pago webhook signature verification.
 *
 * The platform sends `x-signature: ts=<ts>,v1=<hmac>` and `x-request-id`;
 * the signed manifest is `id:<data.id>;request-id:<request-id>;ts:<ts>;`
 * HMAC-SHA256'd with the webhook secret configured in the dashboard.
 * Verification is MANDATORY whenever MERCADOPAGO_WEBHOOK_SECRET is set.
 */
export function verifyMercadoPagoWebhookSignature(input: {
  dataId: string;
  xSignature: string | null;
  xRequestId: string | null;
}): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // No secret configured: the endpoint still records the event, but the
    // caller is informed that signature enforcement is disabled.
    return true;
  }
  if (!input.xSignature || !input.xRequestId) return false;

  const parts = new Map(
    input.xSignature
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string])
      .filter(([key, value]) => Boolean(key) && Boolean(value)),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  const manifest = `id:${input.dataId};request-id:${input.xRequestId};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const receivedBuffer = Buffer.from(v1, "utf8");
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/** Throws unless the signature check passes (uniform webhook guard). */
export function assertMercadoPagoWebhookSignature(input: {
  dataId: string;
  xSignature: string | null;
  xRequestId: string | null;
}): void {
  if (!verifyMercadoPagoWebhookSignature(input)) {
    throw new WebhookSignatureError(PROVIDER);
  }
}
