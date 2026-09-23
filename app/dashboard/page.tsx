import type { Metadata } from "next";
import { Suspense } from "react";
import {
  Activity,
  BadgePercent,
  CircleDollarSign,
  Megaphone,
  Package,
  Plug,
  ShoppingCart,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { SectionCard } from "@/components/ui/section-card";
import { QuickAction } from "@/components/ui/quick-action";
import { MetricBadge } from "@/components/ui/metric-badge";
import { ActivityTimeline, type ActivityItem } from "@/components/ui/activity-timeline";
import { Badge } from "@/components/ui/badge";
import { StatCardSkeleton, ChartSkeleton } from "@/components/ui/skeleton";
import { FadeIn } from "@/components/ui/motion";
import { DashboardCharts } from "@/components/dashboard/dashboard-charts";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { requireOrganization, requireUser } from "@/lib/session";
import { isManager } from "@/lib/rbac";
import { getDashboardOverview } from "@/lib/dashboard-overview";
import { onboardingService } from "@/modules/auth/onboarding.service";
import { formatCurrency } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Enterprise overview dashboard (PR010.1).
 *
 * KPI row: GMV · Pedidos · Creators · ROI · Conversão · Receita (margem).
 * Charts: área (GMV/dia) · rosca (pipeline de creators) · linha (pedidos/dia)
 * · barras horizontais (receita por produto e por creator).
 *
 * Every number is READ from the existing PR008 analytics pipeline and from
 * tenant-scoped counters — no business rule is defined or changed here. The
 * tenant always comes from the session, never from the request.
 *
 * MEMBER users see the same layout; monetary figures remain available because
 * `/dashboard` is the MEMBER landing page and these are the tenant's own
 * aggregates (the MANAGER+ gate stays on `/dashboard/analytics`, which exposes
 * the granular, per-row attribution).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  const [overview, onboarding] = await Promise.all([
    getDashboardOverview(organizationId),
    // PR010.4 §9 — derived from live tenant counts, so it is always honest.
    onboardingService.getState(organizationId),
  ]);

  const canManage = isManager(user.role);
  const periodDays = overview.period.days;

  const activity: ActivityItem[] = buildActivity(overview);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={`Visão geral do seu comércio social orientado a creators — últimos ${periodDays} dias.`}
        actions={
          <>
            <Badge tone={overview.stale ? "warning" : "success"} dot>
              {overview.stale ? "Snapshot desatualizado" : "Dados atualizados"}
            </Badge>
            <Badge tone="neutral">{periodDays} dias</Badge>
          </>
        }
      />

      {/* PR010.4 §9 — first-run onboarding, above everything else.
          A workspace created a minute ago has nothing to chart; this panel is
          what turns six zeroed KPI cards into four things worth doing. It
          renders only while the checklist is unfinished and undismissed. */}
      {onboarding.visible && (
        <FadeIn className="mb-4">
          <OnboardingChecklist
            steps={onboarding.steps}
            completed={onboarding.completed}
            total={onboarding.total}
          />
        </FadeIn>
      )}

      {/* KPI row */}
      <FadeIn>
        <Suspense fallback={<KpiSkeletonRow />}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <StatCard
              label="GMV"
              value={formatCurrency(overview.gmvCents)}
              delta={`${overview.orders} pedido(s) pago(s)`}
              trend={overview.gmvCents > 0 ? "up" : "neutral"}
              icon={CircleDollarSign}
            />
            <StatCard
              label="Pedidos"
              value={overview.orders.toLocaleString("pt-BR")}
              delta={`Ticket médio ${formatCurrency(overview.avgTicketCents)}`}
              trend="neutral"
              icon={ShoppingCart}
            />
            <StatCard
              label="Creators"
              value={overview.counts.creators.toLocaleString("pt-BR")}
              delta={`${overview.counts.activeCampaigns} campanha(s) ativa(s)`}
              trend="neutral"
              icon={Users}
            />
            <StatCard
              label="ROI"
              value={formatBps(overview.roiBps)}
              delta="retorno sobre custo estimado"
              trend={overview.roiBps > 0 ? "up" : "neutral"}
              icon={Target}
            />
            <StatCard
              label="Conversão"
              value={formatBps(overview.conversionBps)}
              delta="pagos ÷ (pagos + pendentes)"
              trend={overview.conversionBps >= 5000 ? "up" : "neutral"}
              icon={BadgePercent}
            />
            <StatCard
              label="Receita (margem)"
              value={formatCurrency(overview.grossMarginCents)}
              delta="margem bruta estimada"
              trend={overview.grossMarginCents > 0 ? "up" : "neutral"}
              icon={TrendingUp}
            />
          </div>
        </Suspense>
      </FadeIn>

      {/* Charts */}
      <div className="mt-4">
        <Suspense fallback={<ChartSkeleton />}>
          <DashboardCharts
            daily={overview.daily}
            topProducts={overview.topProducts}
            topCreators={overview.topCreators}
            creatorFunnel={overview.creatorFunnel}
            periodDays={periodDays}
          />
        </Suspense>
      </div>

      {/* Quick actions + activity */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <SectionCard
          className="lg:col-span-2"
          title="Ações rápidas"
          description="Atalhos para as operações mais frequentes do seu dia."
          icon={Sparkles}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <QuickAction
              href="/dashboard/products/new"
              icon={Package}
              label="Cadastrar produto"
              description="Novo SKU com custo e margem"
              disabled={!canManage}
            />
            <QuickAction
              href="/dashboard/creators"
              icon={Users}
              label="Descobrir creators"
              description="Multi-source: TikTok, Instagram, Shopee"
            />
            <QuickAction
              href="/dashboard/campaigns"
              icon={Megaphone}
              label="Nova campanha"
              description="Produtos, audiência e orçamento"
              badge={
                <MetricBadge
                  hideIcon
                  trend="neutral"
                  label={`${overview.counts.activeCampaigns} ativas`}
                />
              }
            />
            <QuickAction
              href="/dashboard/connectors"
              icon={Plug}
              label="Conectar plataforma"
              description="Importar conteúdo e catálogo externo"
            />
          </div>
        </SectionCard>

        <SectionCard
          title="Resumo operacional"
          description="O estado atual do seu workspace."
          icon={Activity}
        >
          <ActivityTimeline
            items={activity}
            emptyMessage="Comece cadastrando um produto ou descobrindo creators."
          />
        </SectionCard>
      </div>
    </>
  );
}

/** Basis points → `12,4%` (pt-BR). */
function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Derive the operational summary feed from the overview read model.
 *
 * Deliberately derived (not fetched): there is no notification/event domain in
 * the backend yet, so inventing one here would be a business-rule change. These
 * entries only restate figures already on the page.
 */
function buildActivity(overview: Awaited<ReturnType<typeof getDashboardOverview>>): ActivityItem[] {
  const items: ActivityItem[] = [
    {
      id: "catalog",
      title: `${overview.counts.products.toLocaleString("pt-BR")} produto(s) no catálogo`,
      description: "SKUs disponíveis para campanhas e matching.",
      timestamp: "Total do workspace",
      icon: Package,
      tone: overview.counts.products > 0 ? "brand" : "neutral",
    },
    {
      id: "creators",
      title: `${overview.counts.creators.toLocaleString("pt-BR")} creator(s) no CRM`,
      description: "Perfis descobertos e em relacionamento.",
      timestamp: "Total do workspace",
      icon: Users,
      tone: overview.counts.creators > 0 ? "success" : "neutral",
    },
    {
      id: "campaigns",
      title: `${overview.counts.activeCampaigns.toLocaleString("pt-BR")} campanha(s) ativa(s)`,
      description: `${overview.counts.totalCampaigns.toLocaleString("pt-BR")} campanha(s) no total.`,
      timestamp: "Total do workspace",
      icon: Megaphone,
      tone: overview.counts.activeCampaigns > 0 ? "brand" : "neutral",
    },
    {
      id: "gmv",
      title: `${formatCurrency(overview.gmvCents)} de GMV`,
      description: `Receita paga acumulada nos últimos ${overview.period.days} dias.`,
      timestamp: `Período de ${overview.period.days} dias`,
      icon: CircleDollarSign,
      tone: overview.gmvCents > 0 ? "success" : "neutral",
    },
  ];

  if (overview.stale) {
    items.unshift({
      id: "stale",
      title: "Snapshot de analytics desatualizado",
      description: "Novas vendas foram registradas após o último cálculo.",
      timestamp: "Agora",
      icon: Activity,
      tone: "warning",
    });
  }

  return items;
}

function KpiSkeletonRow() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6" aria-busy>
      {Array.from({ length: 6 }).map((_, index) => (
        <StatCardSkeleton key={index} />
      ))}
    </div>
  );
}
