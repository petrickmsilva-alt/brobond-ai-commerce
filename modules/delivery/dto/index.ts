import type { DeliveryAccountStatus, DeliveryChannel, DeliveryStatus } from "@prisma/client";

/**
 * Delivery DTOs (PR010) — CLIENT-SAFE projections.
 *
 * SECURITY CONTRACT: no DTO ever carries `encryptedAccessToken`,
 * `encryptedRefreshToken`, Meta app credentials or raw provider payloads
 * beyond the denormalized display fields below. Server modules map rows to
 * these shapes before anything crosses the RSC → Client Component boundary.
 */

export interface DeliveryAccountDTO {
  id: string;
  channel: DeliveryChannel;
  /** Provider identity (IG Business id / WhatsApp phone number id). */
  accountId: string;
  accountName: string | null;
  status: DeliveryAccountStatus;
  expiresAt: string | null;
  createdAt: string;
}

export interface DeliveryMessageDTO {
  id: string;
  executionId: string;
  channel: DeliveryChannel;
  recipientId: string;
  recipientName: string | null;
  status: DeliveryStatus;
  providerMessageId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  creatorName: string | null;
  /** Text body (text messages) or template name (template messages). */
  messagePreview: string | null;
  messageType: "text" | "template" | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  /** Milliseconds between send and delivery — the "Tempo de entrega" KPI. */
  deliveryLatencyMs: number | null;
  nextAttemptAt: string | null;
  createdAt: string;
}

/** Dashboard KPI set (Fila · Enviadas · Entregues · Lidas · Falhas). */
export interface DeliveryKpisDTO {
  /** QUEUED + SENDING — everything still in the pipeline. */
  queued: number;
  /** SENT + DELIVERED + READ — successfully handed to the provider. */
  sent: number;
  /** DELIVERED + READ. */
  delivered: number;
  read: number;
  failed: number;
  cancelled: number;
  draft: number;
}

export interface DeliveryCampaignFacetDTO {
  campaignId: string;
  campaignName: string | null;
}

export interface DeliveryAuditLogDTO {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export interface DeliveryDashboardDTO {
  accounts: DeliveryAccountDTO[];
  kpis: DeliveryKpisDTO;
  campaigns: DeliveryCampaignFacetDTO[];
  logs: DeliveryAuditLogDTO[];
}

export interface DeliveryMessagePageDTO {
  rows: DeliveryMessageDTO[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type DeliveryActionResult<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
