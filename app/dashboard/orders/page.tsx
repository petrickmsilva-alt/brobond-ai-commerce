import type { Metadata } from "next";
import {
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Package,
  ReceiptText,
  ShoppingCart,
  Wallet,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { OrderStatusActions } from "@/components/orders/order-status-actions";
import { requireOrganization, requireUser } from "@/lib/session";
import { formatCurrency } from "@/lib/utils";
import { getCommerceHealthSnapshot } from "@/modules/payments/health.service";
import { salesService } from "@/modules/sales/sales.service";
import { SaleStatus } from "@prisma/client";

export const metadata: Metadata = {
  title: "Pedidos",
};

interface OrdersPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const statusBadgeTone: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = {
  [SaleStatus.PAID]: "success",
  [SaleStatus.PENDING]: "warning",
  [SaleStatus.REFUNDED]: "info",
  [SaleStatus.CANCELLED]: "danger",
};

const statusLabel: Record<string, string> = {
  [SaleStatus.PAID]: "Pago",
  [SaleStatus.PENDING]: "Pendente",
  [SaleStatus.REFUNDED]: "Reembolsado",
  [SaleStatus.CANCELLED]: "Cancelado",
};

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  const [orders, summary, health] = await Promise.all([
    salesService.list(organizationId, { take: 50 }),
    salesService.summary(organizationId),
    getCommerceHealthSnapshot(organizationId),
  ]);
  const params = await searchParams;
  const checkoutStatus =
    params.checkout && typeof params.checkout === "string" ? params.checkout : undefined;

  const canManageOrders = user.role !== "MEMBER";
  const totalRevenue = summary.totalRevenueCents;
  const paidCount = summary.paidCount;
  const pendingCount = summary.pendingCount;
  const refundedCount = summary.refundedCount;
  const conversionRate = orders.length > 0 ? (paidCount / orders.length) * 100 : 0;

  return (
    <>
      <PageHeader
        eyebrow="Commerce"
        title="Pedidos"
        description="Checkout, pagamento e ciclo de ordem em um único painel operacional."
      />

      {checkoutStatus && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-surface-850 px-4 py-3 text-sm text-white/80">
          {checkoutStatus === "success" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          ) : (
            <XCircle className="h-4 w-4 text-amber-300" />
          )}
          {checkoutStatus === "success"
            ? "Pagamento confirmado e pedido registrado no workspace."
            : "Checkout cancelado ou não concluído — você pode tentar novamente quando quiser."}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total de pedidos" value={String(orders.length)} icon={ShoppingCart} />
        <KpiCard label="Receita" value={formatCurrency(totalRevenue)} icon={CircleDollarSign} />
        <KpiCard label="Pagos" value={String(paidCount)} icon={CheckCircle2} />
        <KpiCard label="Pendentes" value={String(pendingCount)} icon={Clock3} />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <KpiCard label="Reembolsados" value={String(refundedCount)} icon={ReceiptText} />
        <KpiCard
          label="Ticket médio"
          value={formatCurrency(orders.length ? totalRevenue / orders.length : 0)}
          icon={Wallet}
        />
        <KpiCard
          label="Itens"
          value={String(orders.reduce((sum, order) => sum + order.quantity, 0))}
          icon={Package}
        />
        <KpiCard
          label="Conversão"
          value={`${conversionRate.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
          icon={CheckCircle2}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>Saúde operacional do checkout</CardTitle>
            <CardDescription>
              Estado do provedor de pagamento e readiness do fluxo em produção/local.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">Provedor</div>
            <div className="mt-2 text-lg font-semibold text-white">{health.provider}</div>
            <div className="mt-2 text-xs text-white/55">
              {health.providerConfigured ? "Configuração ativa" : "Sem configuração ativa"}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">
              Webhook Stripe
            </div>
            <div className="mt-2 text-lg font-semibold text-white">
              {health.webhookConfigured ? "Configurado" : "Não configurado"}
            </div>
            <div className="mt-2 text-xs text-white/55">
              {health.stripeReady ? "Pagamento em produção pronto" : "Fallback/mock em uso"}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <div className="text-[11px] uppercase tracking-[0.12em] text-white/45">Status</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {health.status === "healthy"
                ? "Healthy"
                : health.status === "warning"
                  ? "Warning"
                  : "Critical"}
            </div>
            <div className="mt-2 text-xs text-white/55">
              {health.recommendations[0] ?? "Fluxo está sendo processado normalmente."}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Últimos pedidos</CardTitle>
            <CardDescription>
              Fluxo comercial do workspace, com status visível e rastreio por referência.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto p-0">
          {orders.length === 0 ? (
            <div className="px-6 py-12 text-sm text-white/55">
              Nenhum pedido registrado ainda. Quando o checkout for iniciado, ele aparecerá aqui.
            </div>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-white/8 bg-white/[0.02] text-white/55">
                <tr>
                  <th className="px-6 py-3 font-medium">Pedido</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Valor</th>
                  <th className="px-6 py-3 font-medium">Qtde.</th>
                  <th className="px-6 py-3 font-medium">Moeda</th>
                  <th className="px-6 py-3 font-medium">Ocorrido</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-white/6 last:border-none align-top">
                    <td className="px-6 py-4">
                      <div className="font-medium text-white/90">{order.reference}</div>
                      <div className="mt-1 text-xs text-white/45">#{order.id.slice(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-2">
                        <Badge tone={statusBadgeTone[order.status] ?? "neutral"}>
                          {statusLabel[order.status] ?? order.status}
                        </Badge>
                        {canManageOrders && (
                          <OrderStatusActions orderId={order.id} status={order.status} />
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-white/80">{formatCurrency(order.amountCents)}</td>
                    <td className="px-6 py-4 text-white/80">{order.quantity}</td>
                    <td className="px-6 py-4 text-white/80">{order.currency}</td>
                    <td className="px-6 py-4 text-white/65">
                      {new Date(order.occurredAt).toLocaleString("pt-BR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
