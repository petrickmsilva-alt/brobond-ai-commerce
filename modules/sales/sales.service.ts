import "server-only";

import { prisma } from "@/lib/prisma";
import { assertOrganizationId } from "@/lib/tenant";
import { SaleStatus } from "@prisma/client";

export interface SaleListOptions {
  status?: SaleStatus | string;
  take?: number;
}

export interface SaleCreateInput {
  organizationId: string;
  amountCents: number;
  quantity?: number;
  currency?: string;
  status?: SaleStatus | string;
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
    const currency = input.currency ?? "BRL";

    return prisma.sale.create({
      data: {
        organizationId: scope,
        amountCents,
        quantity,
        currency,
        status,
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
};
