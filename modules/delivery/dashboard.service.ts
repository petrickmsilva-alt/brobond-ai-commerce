import "server-only";

import type { DeliveryAccountStatus, DeliveryMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import type { DeliveryStatusName } from "./core/delivery.interface";
import type {
  DeliveryAccountDTO,
  DeliveryAuditLogDTO,
  DeliveryDashboardDTO,
  DeliveryKpisDTO,
  DeliveryMessageDTO,
  DeliveryMessagePageDTO,
} from "./dto";
import {
  createDeliveryRepository,
  deliveryRepository,
  type DeliveryRepository,
} from "./repositories/delivery.repository";
import type { DeliveryFiltersInput } from "./validators";

/**
 * Delivery dashboard service (PR010 §8) — read-side projections.
 *
 * Maps persistence rows to CLIENT-SAFE DTOs: ciphertext columns are never
 * selected (accounts are projected through `listAccounts`, which excludes
 * token columns at the Prisma `select` level).
 */

function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function toDeliveryAccountDTO(row: {
  id: string;
  channel: DeliveryAccountDTO["channel"];
  accountId: string;
  accountName: string | null;
  status: DeliveryAccountStatus;
  expiresAt: Date | null;
  createdAt: Date;
}): DeliveryAccountDTO {
  return {
    id: row.id,
    channel: row.channel,
    accountId: row.accountId,
    accountName: row.accountName,
    status: row.status,
    expiresAt: toIsoOrNull(row.expiresAt),
    createdAt: row.createdAt.toISOString(),
  };
}

interface DeliveryPayloadShape {
  campaignId?: unknown;
  campaignName?: unknown;
  creatorName?: unknown;
  message?: { type?: unknown; text?: unknown; templateName?: unknown } | undefined;
}

export function toDeliveryMessageDTO(row: DeliveryMessage): DeliveryMessageDTO {
  const payload = (row.payload ?? {}) as DeliveryPayloadShape;
  const message = payload.message ?? {};
  const messageType = message.type === "text" || message.type === "template" ? message.type : null;
  const preview =
    messageType === "text" && typeof message.text === "string"
      ? message.text.slice(0, 120)
      : messageType === "template" && typeof message.templateName === "string"
        ? `Template: ${message.templateName}`
        : null;
  return {
    id: row.id,
    executionId: row.executionId,
    channel: row.channel,
    recipientId: row.recipientId,
    recipientName: row.recipientName,
    status: row.status,
    providerMessageId: row.providerMessageId,
    campaignId: typeof payload.campaignId === "string" ? payload.campaignId : null,
    campaignName: typeof payload.campaignName === "string" ? payload.campaignName : null,
    creatorName: typeof payload.creatorName === "string" ? payload.creatorName : null,
    messagePreview: preview,
    messageType,
    attempts: row.attempts,
    lastError: row.lastError,
    sentAt: toIsoOrNull(row.sentAt),
    deliveredAt: toIsoOrNull(row.deliveredAt),
    readAt: toIsoOrNull(row.readAt),
    deliveryLatencyMs:
      row.sentAt && row.deliveredAt ? row.deliveredAt.getTime() - row.sentAt.getTime() : null,
    nextAttemptAt: toIsoOrNull(row.nextAttemptAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** KPI rollup from raw per-status counters (pure — unit-testable). */
export function computeDeliveryKpis(counts: Record<string, number>): DeliveryKpisDTO {
  const count = (status: DeliveryStatusName) => counts[status] ?? 0;
  return {
    queued: count("QUEUED") + count("SENDING"),
    sent: count("SENT") + count("DELIVERED") + count("READ"),
    delivered: count("DELIVERED") + count("READ"),
    read: count("READ"),
    failed: count("FAILED"),
    cancelled: count("CANCELLED"),
    draft: count("DRAFT"),
  };
}

export interface DeliveryDashboardDependencies {
  repository?: DeliveryRepository;
}

export function createDeliveryDashboard(deps: DeliveryDashboardDependencies = {}) {
  const repository = deps.repository ?? createDeliveryRepository(prisma);

  return {
    async getDashboard(organizationId: string): Promise<DeliveryDashboardDTO> {
      const scope = assertOrganizationId(organizationId);
      const [accounts, counts, campaigns, logs] = await Promise.all([
        repository.listAccounts(scope),
        repository.statusCounts(scope),
        repository.listCampaignFacets(scope),
        repository.listAuditLogs(scope, 15),
      ]);
      return {
        accounts: accounts.map(toDeliveryAccountDTO),
        kpis: computeDeliveryKpis(counts),
        campaigns: campaigns.map((campaign) => ({
          campaignId: campaign.campaignId,
          campaignName: campaign.campaignName,
        })),
        logs: logs.map((log): DeliveryAuditLogDTO => ({
          id: log.id,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          createdAt: log.createdAt.toISOString(),
        })),
      };
    },

    async listMessages(
      organizationId: string,
      filters: DeliveryFiltersInput,
    ): Promise<DeliveryMessagePageDTO> {
      const scope = assertOrganizationId(organizationId);
      const { rows, total } = await repository.listMessages(scope, filters);
      const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
      return {
        rows: rows.map(toDeliveryMessageDTO),
        total,
        page: filters.page,
        pageSize: filters.pageSize,
        totalPages,
      };
    },
  };
}

export const deliveryDashboardService = createDeliveryDashboard({
  repository: deliveryRepository,
});
