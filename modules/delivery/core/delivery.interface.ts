/**
 * Omnichannel Delivery Engine — module contracts (PR010).
 *
 * This file is the plug-in surface of the delivery layer:
 *  - the mirrors of the Prisma `DeliveryChannel` / `DeliveryStatus` enums,
 *  - the deterministic status transition map (DRAFT → QUEUED → SENDING →
 *    SENT → DELIVERED → READ, with FAILED/CANCELLED as terminal states),
 *  - the `DeliveryConnector` interface implemented by the Instagram Business
 *    and WhatsApp Cloud API connectors,
 *  - the `CommerceExecution` intake shape consumed by the dispatcher.
 *
 * CLIENT-SAFE on purpose: this file must never import `@prisma/client` as a
 * runtime value (only as a type) and never import a `server-only` module —
 * the dashboard imports the channel/status lists and labels to render.
 */

import type { DeliveryChannel, DeliveryStatus } from "@prisma/client";

// ------------------------------------------------------------------
// Channels
// ------------------------------------------------------------------

/** Channels wired in PR010. Kept in sync with the Prisma enum (pinned by
 * `tests/delivery-channel.test.ts`). */
export const DELIVERY_CHANNELS = ["INSTAGRAM", "WHATSAPP"] as const;

export type DeliveryChannelName = (typeof DELIVERY_CHANNELS)[number];

export const DELIVERY_CHANNEL_LABELS: Record<DeliveryChannelName, string> = {
  INSTAGRAM: "Instagram Business",
  WHATSAPP: "WhatsApp Business",
};

export function isDeliveryChannel(value: unknown): value is DeliveryChannelName {
  return typeof value === "string" && (DELIVERY_CHANNELS as readonly string[]).includes(value);
}

// ------------------------------------------------------------------
// Status lifecycle
// ------------------------------------------------------------------

/** All statuses, in declaration order (mirrors the Prisma enum). */
export const DELIVERY_STATUSES = [
  "DRAFT",
  "QUEUED",
  "SENDING",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
  "CANCELLED",
] as const;

export type DeliveryStatusName = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatusName, string> = {
  DRAFT: "Rascunho",
  QUEUED: "Na fila",
  SENDING: "Enviando",
  SENT: "Enviada",
  DELIVERED: "Entregue",
  READ: "Lida",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

/**
 * Monotonic rank of the happy-path progression. Terminal side-states
 * (FAILED/CANCELLED) carry no rank: a delivery receipt (SENT/DELIVERED/READ)
 * may only move a message forward, never backward.
 */
export const DELIVERY_STATUS_RANK: Partial<Record<DeliveryStatusName, number>> = {
  DRAFT: 0,
  QUEUED: 1,
  SENDING: 2,
  SENT: 3,
  DELIVERED: 4,
  READ: 5,
};

/**
 * The legal transition map — the ONLY definition of the lifecycle. Any
 * status write outside these edges is rejected by the service layer.
 *
 * QUEUED → QUEUED models a retry re-queue (the scheduler reschedules the
 * same message with a fresh `nextAttemptAt` while it still has attempts).
 */
export const DELIVERY_TRANSITIONS: Record<DeliveryStatusName, readonly DeliveryStatusName[]> = {
  DRAFT: ["QUEUED", "CANCELLED"],
  QUEUED: ["QUEUED", "SENDING", "CANCELLED"],
  SENDING: ["QUEUED", "SENT", "FAILED", "CANCELLED"],
  SENT: ["DELIVERED", "READ", "FAILED"],
  DELIVERED: ["READ"],
  READ: [],
  FAILED: ["QUEUED"],
  CANCELLED: ["QUEUED"],
};

export const TERMINAL_DELIVERY_STATUSES: readonly DeliveryStatusName[] = ["READ", "CANCELLED"];

/** Whether `from → to` is a legal lifecycle transition. */
export function canTransitionDeliveryStatus(
  from: DeliveryStatusName,
  to: DeliveryStatusName,
): boolean {
  return DELIVERY_TRANSITIONS[from].includes(to);
}

/** Assert a legal transition; throws `DeliveryStateError` otherwise. */
export function assertDeliveryTransition(
  from: DeliveryStatusName,
  to: DeliveryStatusName,
): DeliveryStatusName {
  if (!canTransitionDeliveryStatus(from, to)) {
    throw new DeliveryStateError(`Illegal delivery status transition: ${from} → ${to}.`);
  }
  return to;
}

/**
 * Whether a receipt moving the message to `next` actually advances it —
 * receipts are idempotent and must never regress a message (e.g. a late
 * DELIVERED must not overwrite READ).
 */
export function isForwardProgress(current: DeliveryStatusName, next: DeliveryStatusName): boolean {
  const currentRank = DELIVERY_STATUS_RANK[current];
  const nextRank = DELIVERY_STATUS_RANK[next];
  if (currentRank === undefined || nextRank === undefined) return false;
  return nextRank > currentRank;
}

export function isDeliveryStatus(value: unknown): value is DeliveryStatusName {
  return typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);
}

// ------------------------------------------------------------------
// Outbound message shapes
// ------------------------------------------------------------------

/** Outbound message kinds supported across channels in PR010. */
export type DeliveryOutboundMessage =
  | { type: "text"; text: string }
  | {
      type: "template";
      templateName: string;
      /** BCP-47-ish Meta template language code (e.g. `pt_BR`, `en_US`). */
      language: string;
      components?: WhatsAppTemplateComponent[];
    };

/** Minimal Meta template component shape (header/body/button parameters). */
export interface WhatsAppTemplateComponent {
  type: "header" | "body" | "button";
  sub_type?: string;
  index?: string;
  parameters: Array<
    | { type: "text"; text: string }
    | { type: "currency"; currency: { fallback_value: string; code: string; amount_1000: number } }
    | {
        type: "date_time";
        date_time: { fallback_value: string };
      }
  >;
}

// ------------------------------------------------------------------
// Connector contract
// ------------------------------------------------------------------

/** Decrypted, send-ready account projection — server-side ONLY, never a DTO. */
export interface ResolvedDeliveryAccount {
  /** Provider identity: IG Business Account id or WhatsApp phone number id. */
  accountId: string;
  accountName: string | null;
  /** Plaintext access token, decrypted in-memory for a single send call. */
  accessToken: string;
}

export interface DeliverySendRequest {
  account: ResolvedDeliveryAccount;
  recipientId: string;
  message: DeliveryOutboundMessage;
}

export interface DeliverySendResult {
  /** Provider message id used to join future webhook receipts. */
  providerMessageId: string;
}

/**
 * The contract every channel connector fulfills. Instances come exclusively
 * from `modules/delivery/core/delivery.factory.ts` — no `switch` or `if`
 * chain outside that factory may map a channel to an implementation.
 */
export interface DeliveryConnector {
  readonly channel: DeliveryChannelName;
  /**
   * Send one already-queued message through the official provider API.
   * Implementations throw `DeliveryProviderError` (retryable or not) on
   * failure and never swallow a provider error code.
   */
  sendMessage(request: DeliverySendRequest): Promise<DeliverySendResult>;
}

// ------------------------------------------------------------------
// CommerceExecution intake (dispatcher contract)
// ------------------------------------------------------------------

/** Gate status of an approved commerce execution. */
export const COMMERCE_EXECUTION_APPROVED = "APPROVED" as const;

/**
 * The dispatcher's intake: one approved `CommerceExecution` requesting a
 * delivery to one recipient. `executionId` is the idempotency anchor —
 * re-dispatching the same execution can never duplicate a provider send.
 */
export interface CommerceExecutionDeliveryRequest {
  organizationId: string;
  executionId: string;
  /** Only `APPROVED` executions may enter the delivery queue. */
  status: string;
  channel: DeliveryChannelName;
  recipientId: string;
  recipientName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  creatorId?: string | null;
  creatorName?: string | null;
  message: DeliveryOutboundMessage;
}

// ------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------

/** Base error for everything thrown by the delivery module. */
export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

/** Missing/invalid module configuration (env vars, urls). Never retryable. */
export class DeliveryConfigurationError extends DeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryConfigurationError";
  }
}

/** Illegal lifecycle transition or state violation. Never retryable. */
export class DeliveryStateError extends DeliveryError {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryStateError";
  }
}

/** Channel without a registered connector in the factory. */
export class DeliveryConnectorNotRegisteredError extends DeliveryError {
  constructor(channel: string) {
    super(`No delivery connector registered for channel "${channel}".`);
    this.name = "DeliveryConnectorNotRegisteredError";
  }
}

/**
 * A provider (Meta Graph API) call failed. `retryable` feeds the backoff
 * engine: 408/429/5xx and network failures are retryable; 4xx auth,
 * permission and validation errors are NOT.
 */
export class DeliveryProviderError extends DeliveryError {
  readonly status: number;
  readonly code?: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number; code?: number; retryable?: boolean }) {
    super(message);
    this.name = "DeliveryProviderError";
    this.status = options.status;
    this.code = options.code;
    this.retryable =
      options.retryable ??
      (options.status === 408 || options.status === 429 || options.status >= 500);
  }
}
