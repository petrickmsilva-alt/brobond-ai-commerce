import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  BarChart3,
  CheckCheck,
  CircleAlert,
  Coins,
  DollarSign,
  Eye,
  Hash,
  MailOpen,
  Send,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { requireOrganization, requireUser } from "@/lib/session";
import { isManager } from "@/lib/rbac";
import { analyticsService } from "@/modules/analytics/services/analytics.service";
import { analyticsDaysSchema } from "@/modules/analytics/validators/analytics.validator";
import { formatCurrency } from "@/lib/utils";
import { formatEstimatedCost } from "@/modules/ai/openai/pricing";

export const metadata: Metadata = { title: "Analytics" };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AnalyticsPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  // Revenue & margin are business-sensitive: the dashboard is MANAGER+
  // (ADMIN included). MEMBER users are sent back to the main dashboard.
  if (!isManager(user.role)) {
    redirect("/dashboard");
  }

  const raw = await searchParams;
  const days = analyticsDaysSchema.parse(Array.isArray(raw.days) ? raw.days[0] : raw.days);

  const dashboard = await analyticsService.getDashboard(organizationId, { days });
  const { totals, attribution, ai, delivery } = dashboard.metrics;

  return (
    <>
      <PageHeader
        title="Analytics & Atribuição"
        description="Pipeline de métricas determinístico — receita, margem e atribuição por produto, creator e campanha."
        actions={
          <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Performance live
          </Badge>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Receita (PAID)"
          value={formatCurrency(totals.revenueCents)}
          delta={`${totals.paidCount} vendas pagas`}
          icon={DollarSign}
        />
        <KpiCard
          label="Margem bruta"
          value={formatCurrency(totals.grossMarginCents)}
          delta={`${(totals.grossMarginBps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% da receita`}
          icon={Coins}
        />
        <KpiCard
          label="Ticket médio"
          value={formatCurrency(totals.avgTicketCents)}
          delta={`${totals.unitsSold} unidades`}
          icon={ShoppingCart}
        />
        <KpiCard
          label="Pipeline pendente"
          value={String(totals.pendingCount)}
          delta={`${totals.refundedCount} reembolso(s) · ${totals.cancelledCount} cancelada(s)`}
          icon={Hash}
        />
        <KpiCard
          label="ROI (sobre COGS est.)"
          value={`${(dashboard.metrics.roiBps / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
          delta="retorno sobre custo estimado"
          icon={BarChart3}
        />
        <KpiCard
          label="Uso de IA"
          value={formatEstimatedCost(ai.estimatedCostUsdCents)}
          delta={`${(ai.inputTokens + ai.outputTokens).toLocaleString("pt-BR")} tokens · ${ai.totalMessages} mensagens`}
          icon={Sparkles}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label="Msgs enviadas"
          value={String(delivery.messagesSent)}
          delta={`${delivery.messagesQueued} na fila agora`}
          icon={Send}
        />
        <KpiCard
          label="Msgs entregues"
          value={String(delivery.messagesDelivered)}
          delta={`${(delivery.deliveryRate / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% taxa de entrega`}
          icon={CheckCheck}
        />
        <KpiCard
          label="Msgs lidas"
          value={String(delivery.messagesRead)}
          delta={`${(delivery.readRate / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% taxa de leitura`}
          icon={Eye}
        />
        <KpiCard
          label="Msgs com falha"
          value={String(delivery.messagesFailed)}
          delta="falhas terminais no período"
          icon={CircleAlert}
        />
        <KpiCard
          label="Taxa de leitura"
          value={`${(delivery.readRate / 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
          delta="leituras sobre entregues"
          icon={MailOpen}
        />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Revenue signal
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {totals.paidCount} vendas pagas com margem de{" "}
              {formatCurrency(totals.grossMarginCents)}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="success" size="sm">
              {dashboard.metrics.roiBps / 100}% ROI
            </Badge>
            <Badge tone="info" size="sm">
              {formatEstimatedCost(ai.estimatedCostUsdCents)} IA
            </Badge>
          </div>
        </div>
      </Card>

      <AnalyticsDashboard
        days={days}
        computedAt={dashboard.computedAt}
        stale={dashboard.stale}
        attribution={{
          byProduct: attribution.byProduct,
          byCreator: attribution.byCreator,
          byCampaign: attribution.byCampaign,
        }}
      />
    </>
  );
}
