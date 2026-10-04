import type { TikTokConnectionStatus } from "@prisma/client";

/** Client-safe account projection. OAuth and API credentials are excluded. */
export interface TikTokAccountDTO {
  id: string;
  shopId: string;
  shopName: string | null;
  sellerId: string | null;
  status: TikTokConnectionStatus;
  expiresAt: string | null;
  lastSync: string | null;
  createdAt: string;
}

export interface TikTokAuditLogDTO {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
}

export interface TikTokDashboardDTO {
  accounts: TikTokAccountDTO[];
  connectedAccounts: number;
  synchronizedProducts: number;
  creators: number;
  lastSync: string | null;
  logs: TikTokAuditLogDTO[];
}

export interface TikTokSyncResult {
  accounts: number;
  products: { created: number; updated: number };
  creators: { created: number; updated: number };
  externalContents: { created: number; updated: number };
  ordersFetched: number;
  startedAt: string;
  finishedAt: string;
}

export type TikTokActionErrorCode =
  | "INVALID_INPUT"
  | "FORBIDDEN"
  | "PENDING_APPROVAL"
  | "NOT_FOUND"
  | "LOGIN_KIT_NOT_CONFIGURED"
  | "CALLBACK_MISALIGNED"
  | "UNEXPECTED";

/**
 * Serializable server-action result. A stable code lets the UI and operators
 * distinguish an OAuth callback alignment problem from an unknown execution
 * failure without exposing secrets or relying on translated message text.
 */
export type TikTokActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: TikTokActionErrorCode;
      error: string;
      fieldErrors?: Record<string, string[]>;
    };
