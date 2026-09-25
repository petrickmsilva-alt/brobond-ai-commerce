import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertOctagon, CircleDollarSign, Lightbulb, ListChecks, Sparkles } from "lucide-react";
import { CeoDashboard } from "@/components/ai-ceo/ceo-dashboard";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { isManager } from "@/lib/rbac";
import { requireOrganization, requireUser } from "@/lib/session";
import { formatCurrency } from "@/lib/utils";
import { aiCeoService } from "@/modules/ai-ceo/services/ai-ceo.service";

export const metadata: Metadata = { title: "AI CEO" };

export default async function AICeoPage() {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  if (!isManager(user.role)) redirect("/dashboard");

  const data = await aiCeoService.getDashboard(organizationId);
  const canExecute = isManager(user.role);

  return (
    <>
      <PageHeader
        title="AI CEO"
        description="Inteligência executiva consultiva: oportunidades, prioridades, decisões auditáveis e relatório diário."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Oportunidades"
          value={String(data.kpis.opportunities)}
          delta="ativas com receita potencial"
          icon={Lightbulb}
        />
        <KpiCard
          label="Receita Potencial"
          value={formatCurrency(data.kpis.potentialRevenueCents)}
          delta="decisões pendentes + aprovadas"
          icon={CircleDollarSign}
        />
        <KpiCard
          label="Decisões Pendentes"
          value={String(data.kpis.pending)}
          delta="aguardando decisão humana"
          icon={ListChecks}
        />
        <KpiCard
          label="Prioridade Crítica"
          value={String(data.kpis.critical)}
          delta="pendentes ou aprovadas"
          icon={AlertOctagon}
        />
      </div>

      <CeoDashboard data={data} role={user.role} />
    </>
  );
}
