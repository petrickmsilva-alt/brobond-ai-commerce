/**
 * Shared domain types.
 *
 * These re-export Prisma-generated types and add lightweight DTOs used
 * across the UI and module layers.
 */
export type {
  User,
  Product,
  Creator,
  Campaign,
  Message,
  Sale,
  UserRole,
  ProductStatus,
  CreatorStatus,
  CampaignStatus,
  SaleStatus,
} from "@prisma/client";

export interface KpiCard {
  id: string;
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ActionResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };
