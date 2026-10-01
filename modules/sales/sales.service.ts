import "server-only";

import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import { SaleChannel, SaleStatus, type Sale } from "@prisma/client";
import { DEFAULT_SALE_CHANNEL, isSaleChannelName } from "./sales-channel";

export interface SaleListOptions {
  status?: SaleStatus | string;
  /** Filter by origin platform (PR013 — Hub Multicanal de Vendas). */
  channel?: SaleChannel | string;
  take?: number;
}

export interface SaleCreateInput {
  organizationId: string;
  amountCents: number;
  quantity?: number;
  currency?: string;
  status?: SaleStatus | string;
  /**
   * Origin platform of this revenue. Defaults to `BROBOND` (own store
   * checkout) — see `modules/sales/sales-channel.ts`.
   */
  channel?: SaleChannel | string;
  /** Order id on the origin platform (`null`/omitted for Brobond). */
  externalOrderId?: string | null;
  occurredAt?: Date | string;
  reference?: string;
  productId?: string | null;
  creatorId?: string | null;
  campaignId?: string | null;
}

export interface SaleSummary {
  totalRevenueCents: number;
  paidRevenueCents: number;
  pendingRevenueCents: number;
  refundedRevenueCents: number;
  cancelledRevenueCents: number;
  paidCount: number;
  pendingCount: number;
  refundedCount: number;
  cancelledCount: number;
}

export function normalizeSaleStatus(input: SaleStatus | string | null | undefined): SaleStatus {
  const value = input?.toString().trim().toUpperCase();
  if (!value) return SaleStatus.PENDING;
  if (Object.values(SaleStatus).includes(value as SaleStatus)) {
    return value as SaleStatus;
  }
  throw new Error(`Status de venda inválido: ${input}`);
}

/**
 * Normalize a sale's origin channel (PR013 — Hub Multicanal de Vendas).
 * Unknown/empty input defaults to `BROBOND` — the own-store checkout —
 * instead of throwing, so every pre-PR013 call site keeps working untouched.
 */
export function normalizeSaleChannel(input: SaleChannel | string | null | undefined): SaleChannel {
  const value = input?.toString().trim().toUpperCase();
  if (!value) return SaleChannel[DEFAULT_SALE_CHANNEL];
  if (isSaleChannelName(value)) return SaleChannel[value];
  throw new Error(`Canal de venda inválido: ${input}`);
}

export function canTransitionSaleStatus(
  current: SaleStatus | string,
  next: SaleStatus | string,
): boolean {
  const currentStatus = normalizeSaleStatus(current);
  const nextStatus = normalizeSaleStatus(next);

  if (currentStatus === nextStatus) return true;

  switch (currentStatus) {
    case SaleStatus.PENDING:
      return nextStatus === SaleStatus.PAID || nextStatus === SaleStatus.CANCELLED;
    case SaleStatus.PAID:
      return nextStatus === SaleStatus.REFUNDED || nextStatus === SaleStatus.CANCELLED;
    default:
      return false;
  }
}

export interface SalePaymentDecision {
  ok: boolean;
  expectedAmountCents: number;
  receivedAmountCents: number;
  currency: string;
  reason?: string;
}

export function normalizeSaleCurrency(currency?: string | null): string {
  const value = currency?.trim();
  if (!value) return "BRL";
  const normalized = value.toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : "BRL";
}

export function canAcceptSalePayment(
  sale: { amountCents: number; currency?: string | null; status?: SaleStatus | string },
  payment: { amountCents: number; currency?: string | null },
): SalePaymentDecision {
  const saleStatus = normalizeSaleStatus(sale.status ?? SaleStatus.PENDING);
  const expectedAmountCents = Math.max(0, Math.trunc(Number(sale.amountCents ?? 0)) || 0);
  const receivedAmountCents = Math.max(0, Math.trunc(Number(payment.amountCents ?? 0)) || 0);
  const currency = normalizeSaleCurrency(sale.currency ?? payment.currency);
  const receivedCurrency = normalizeSaleCurrency(payment.currency ?? sale.currency);

  if (saleStatus === SaleStatus.REFUNDED || saleStatus === SaleStatus.CANCELLED) {
    return {
      ok: false,
      expectedAmountCents,
      receivedAmountCents,
      currency,
      reason: `A venda já está em estado terminal (${saleStatus}).`,
    };
  }

  if (expectedAmountCents <= 0) {
    return {
      ok: false,
      expectedAmountCents,
      receivedAmountCents,
      currency,
      reason: "A venda precisa ter um valor positivo para receber pagamento.",
    };
  }

  if (receivedAmountCents !== expectedAmountCents) {
    return {
      ok: false,
      expectedAmountCents,
      receivedAmountCents,
      currency,
      reason: `Valor recebido divergente: esperado ${expectedAmountCents} e recebido ${receivedAmountCents}.`,
    };
  }

  if (currency !== receivedCurrency) {
    return {
      ok: false,
      expectedAmountCents,
      receivedAmountCents,
      currency,
      reason: `Moeda divergente: esperado ${currency} e recebido ${receivedCurrency}.`,
    };
  }

  return { ok: true, expectedAmountCents, receivedAmountCents, currency };
}

export function settleSalePayment(
  sale: { amountCents: number; currency?: string | null; status?: SaleStatus | string },
  payment: { amountCents: number; currency?: string | null },
) {
  const decision = canAcceptSalePayment(sale, payment);
  if (!decision.ok) {
    throw new Error(decision.reason ?? "Pagamento inválido para a venda.");
  }

  return {
    ...sale,
    status: SaleStatus.PAID,
    amountCents: sale.amountCents,
    currency: normalizeSaleCurrency(sale.currency ?? payment.currency),
    paidAt: new Date(),
  };
}

export function createRefundPlan(
  sale: { amountCents: number; status?: SaleStatus | string },
  refundAmountCents?: number,
) {
  const saleStatus = normalizeSaleStatus(sale.status ?? SaleStatus.PENDING);
  if (saleStatus !== SaleStatus.PAID) {
    throw new Error(`Refund só pode ser gerado para vendas pagas, mas a venda está ${saleStatus}.`);
  }

  const saleAmountCents = Math.max(0, Math.trunc(Number(sale.amountCents ?? 0)) || 0);
  const requestedAmountCents = Math.max(
    0,
    Math.trunc(Number(refundAmountCents ?? saleAmountCents)) || 0,
  );
  const refundableAmountCents = Math.min(requestedAmountCents, saleAmountCents);

  return {
    originalAmountCents: saleAmountCents,
    refundAmountCents: refundableAmountCents,
    status: SaleStatus.REFUNDED,
  };
}

/** Sales module — revenue data access and order lifecycle. */
export const salesService = {
  list(organizationId: string, options: SaleListOptions = {}) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.findMany({
      where: {
        organizationId: scope,
        ...(options.status ? { status: normalizeSaleStatus(options.status) } : {}),
        ...(options.channel ? { channel: normalizeSaleChannel(options.channel) } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take: options.take ?? 50,
    });
  },

  getById(organizationId: string, saleId: string) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.findFirst({
      where: { id: saleId, organizationId: scope },
    });
  },

  create(input: SaleCreateInput) {
    const scope = assertOrganizationId(input.organizationId);
    const quantity = Math.max(1, Math.trunc(Number(input.quantity ?? 1)) || 1);
    const amountCents = Math.max(0, Math.trunc(Number(input.amountCents ?? 0)) || 0);
    const status = normalizeSaleStatus(input.status ?? SaleStatus.PENDING);
    const channel = normalizeSaleChannel(input.channel);
    const currency = input.currency ?? "BRL";

    return prisma.sale.create({
      data: {
        organizationId: scope,
        amountCents,
        quantity,
        currency,
        status,
        channel,
        externalOrderId: input.externalOrderId ?? undefined,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        reference: input.reference ?? undefined,
        productId: input.productId ?? undefined,
        creatorId: input.creatorId ?? undefined,
        campaignId: input.campaignId ?? undefined,
      },
    });
  },

  async updateStatus(organizationId: string, saleId: string, status: SaleStatus | string) {
    const scope = assertOrganizationId(organizationId);
    const nextStatus = normalizeSaleStatus(status);
    const current = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: scope },
      select: { status: true },
    });

    if (!current) return null;
    if (!canTransitionSaleStatus(current.status, nextStatus)) {
      throw new Error(`Transição inválida de status da venda: ${current.status} -> ${nextStatus}`);
    }

    return prisma.sale.update({
      where: { id: saleId },
      data: { status: nextStatus },
    });
  },

  markPaid(organizationId: string, saleId: string) {
    return this.updateStatus(organizationId, saleId, SaleStatus.PAID);
  },

  markRefunded(organizationId: string, saleId: string) {
    return this.updateStatus(organizationId, saleId, SaleStatus.REFUNDED);
  },

  markCancelled(organizationId: string, saleId: string) {
    return this.updateStatus(organizationId, saleId, SaleStatus.CANCELLED);
  },

  /**
   * Idempotent ingestion upsert (PR014 — Motor Financeiro Unificado).
   *
   * Marketplace webhooks (Mercado Livre orders, Mercado Pago payments) are
   * delivered at-least-once; this method lands on the tenant-scoped unique
   * key `(organizationId, channel, externalOrderId)` so a replayed delivery
   * can never double-count revenue:
   *
   *   - no existing row  → `created`, but only for `PAID` events — a
   *     `PENDING`/`REFUNDED`/`CANCELLED` notification for a never-seen order
   *     returns `ignored` (nothing to settle or refund);
   *   - existing row     → status transitions obey `canTransitionSaleStatus`
   *     (a terminal sale is never downgraded) and paid amounts are refreshed;
   *     identical replays return `unchanged`.
   *
   * The returned `outcome` drives the connector counters: `created`/`updated`
   * count as imported, `unchanged` as duplicated.
   */
  async upsertIngestedSale(
    organizationId: string,
    input: {
      channel: SaleChannel | string;
      externalOrderId: string;
      amountCents: number;
      currency?: string | null;
      status: SaleStatus | string;
      quantity?: number;
      occurredAt?: Date | string | null;
    },
  ): Promise<{
    sale: Sale | null;
    outcome: "created" | "updated" | "unchanged" | "ignored";
  }> {
    const scope = assertOrganizationId(organizationId);
    const channel = normalizeSaleChannel(input.channel);
    const externalOrderId = input.externalOrderId.trim();
    if (!externalOrderId) {
      throw new Error("O identificador externo da venda é obrigatório.");
    }
    const amountCents = Math.max(0, Math.trunc(Number(input.amountCents ?? 0)) || 0);
    const quantity = Math.max(1, Math.trunc(Number(input.quantity ?? 1)) || 1);
    const currency = normalizeSaleCurrency(input.currency);
    const status = normalizeSaleStatus(input.status);
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

    const existing = await prisma.sale.findUnique({
      where: {
        organizationId_channel_externalOrderId: {
          organizationId: scope,
          channel,
          externalOrderId,
        },
      },
    });

    if (!existing) {
      if (status !== SaleStatus.PAID) {
        // Nothing was ever sold under this id — a pending/refunded
        // notification for an unknown order must not create revenue noise.
        return { sale: null, outcome: "ignored" };
      }
      const sale = await prisma.sale.create({
        data: {
          organizationId: scope,
          amountCents,
          quantity,
          currency,
          status,
          channel,
          externalOrderId,
          occurredAt,
        },
      });
      return { sale, outcome: "created" };
    }

    const sameStatus = existing.status === status;
    const sameAmount = existing.amountCents === amountCents;
    if (sameStatus && sameAmount) return { sale: existing, outcome: "unchanged" };
    if (!canTransitionSaleStatus(existing.status, status)) {
      // e.g. a REFUNDED sale receiving a replayed PAID notification.
      return { sale: existing, outcome: "unchanged" };
    }

    const sale = await prisma.sale.update({
      where: { id: existing.id },
      data: {
        status,
        amountCents,
        quantity,
        currency,
        // Keep the first-seen moment; refresh the settlement timestamp when
        // the order settles (PENDING → PAID).
        occurredAt:
          status === SaleStatus.PAID && existing.status === SaleStatus.PENDING
            ? occurredAt
            : existing.occurredAt,
      },
    });
    return { sale, outcome: "updated" };
  },

  async upsertByReference(
    organizationId: string,
    reference: string,
    data: Omit<SaleCreateInput, "organizationId" | "reference">,
  ) {
    const scope = assertOrganizationId(organizationId);
    const normalizedReference = reference.trim();
    if (!normalizedReference) {
      throw new Error("Referência da venda é obrigatória.");
    }

    return prisma.sale.upsert({
      where: { reference: normalizedReference },
      create: {
        ...data,
        organizationId: scope,
        status: normalizeSaleStatus(data.status ?? SaleStatus.PENDING),
        channel: normalizeSaleChannel(data.channel),
        externalOrderId: data.externalOrderId ?? undefined,
        quantity: Math.max(1, Math.trunc(Number(data.quantity ?? 1)) || 1),
        amountCents: Math.max(0, Math.trunc(Number(data.amountCents ?? 0)) || 0),
        currency: data.currency ?? "BRL",
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
        reference: normalizedReference,
        productId: data.productId ?? undefined,
        creatorId: data.creatorId ?? undefined,
        campaignId: data.campaignId ?? undefined,
      },
      update: {
        amountCents: Math.max(0, Math.trunc(Number(data.amountCents ?? 0)) || 0),
        quantity: Math.max(1, Math.trunc(Number(data.quantity ?? 1)) || 1),
        currency: data.currency ?? undefined,
        status: normalizeSaleStatus(data.status ?? SaleStatus.PENDING),
        channel: normalizeSaleChannel(data.channel),
        externalOrderId: data.externalOrderId ?? undefined,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
        productId: data.productId ?? undefined,
        creatorId: data.creatorId ?? undefined,
        campaignId: data.campaignId ?? undefined,
      },
    });
  },

  async countByStatus(organizationId: string, status?: SaleStatus | string) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.count({
      where: {
        organizationId: scope,
        ...(status ? { status: normalizeSaleStatus(status) } : {}),
      },
    });
  },

  async totalRevenueCents(organizationId: string, status: SaleStatus | string = SaleStatus.PAID) {
    const scope = assertOrganizationId(organizationId);
    const result = await prisma.sale.aggregate({
      _sum: { amountCents: true },
      where: {
        organizationId: scope,
        status: normalizeSaleStatus(status),
      },
    });
    return result._sum.amountCents ?? 0;
  },

  async summary(organizationId: string): Promise<SaleSummary> {
    const scope = assertOrganizationId(organizationId);
    const [paid, pending, refunded, cancelled, total] = await Promise.all([
      prisma.sale.aggregate({
        _sum: { amountCents: true },
        _count: { _all: true },
        where: { organizationId: scope, status: SaleStatus.PAID },
      }),
      prisma.sale.aggregate({
        _sum: { amountCents: true },
        _count: { _all: true },
        where: { organizationId: scope, status: SaleStatus.PENDING },
      }),
      prisma.sale.aggregate({
        _sum: { amountCents: true },
        _count: { _all: true },
        where: { organizationId: scope, status: SaleStatus.REFUNDED },
      }),
      prisma.sale.aggregate({
        _sum: { amountCents: true },
        _count: { _all: true },
        where: { organizationId: scope, status: SaleStatus.CANCELLED },
      }),
      prisma.sale.aggregate({
        _sum: { amountCents: true },
        where: { organizationId: scope },
      }),
    ]);

    return {
      totalRevenueCents: total._sum.amountCents ?? 0,
      paidRevenueCents: paid._sum.amountCents ?? 0,
      pendingRevenueCents: pending._sum.amountCents ?? 0,
      refundedRevenueCents: refunded._sum.amountCents ?? 0,
      cancelledRevenueCents: cancelled._sum.amountCents ?? 0,
      paidCount: paid._count._all ?? 0,
      pendingCount: pending._count._all ?? 0,
      refundedCount: refunded._count._all ?? 0,
      cancelledCount: cancelled._count._all ?? 0,
    };
  },

  count(organizationId: string) {
    const scope = assertOrganizationId(organizationId);
    return prisma.sale.count({ where: { organizationId: scope } });
  },

  /**
   * Revenue/orders grouped by origin platform (PR013 — Hub Multicanal de
   * Vendas). PAID-only revenue, mirroring `summary()`'s revenue convention;
   * `salesCount` covers every status so Pedidos can show channel volume
   * even before a sale settles.
   */
  async summaryByChannel(organizationId: string): Promise<
    Array<{
      channel: SaleChannel;
      revenueCents: number;
      paidCount: number;
      salesCount: number;
    }>
  > {
    const scope = assertOrganizationId(organizationId);
    const [revenueByChannel, countByChannel] = await Promise.all([
      prisma.sale.groupBy({
        by: ["channel"],
        where: { organizationId: scope, status: SaleStatus.PAID },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      prisma.sale.groupBy({
        by: ["channel"],
        where: { organizationId: scope },
        _count: { _all: true },
      }),
    ]);

    const salesCountByChannel = new Map(
      countByChannel.map((row) => [row.channel, row._count._all]),
    );
    const revenueRowByChannel = new Map(revenueByChannel.map((row) => [row.channel, row]));

    // Union of both group-bys: a channel with only PENDING/REFUNDED sales
    // (e.g. a freshly connected marketplace with no settled revenue yet)
    // must still show its order volume, not disappear from the breakdown.
    const allChannels = new Set<SaleChannel>([
      ...revenueByChannel.map((row) => row.channel),
      ...countByChannel.map((row) => row.channel),
    ]);

    return [...allChannels]
      .map((channel) => {
        const revenueRow = revenueRowByChannel.get(channel);
        return {
          channel,
          revenueCents: revenueRow?._sum.amountCents ?? 0,
          paidCount: revenueRow?._count._all ?? 0,
          salesCount: salesCountByChannel.get(channel) ?? 0,
        };
      })
      .sort((a, b) => b.revenueCents - a.revenueCents);
  },
};
