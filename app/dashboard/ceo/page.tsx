import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertOctagon, CircleDollarSign, Lightbulb, ListChecks } from "lucide-react";
import { CeoDashboard } from "@/components/ai-ceo/ceo-dashboard";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
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

  return (
    <>
      <PageHeader
        title="AI CEO"
        description="Inteligência executiva consultiva: oportunidades, prioridades, decisões auditáveis e relatório diário."
        actions={<Badge>v1.0</Badge>}
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

      {/* All interactive controls (generate decisions/report, approve/reject,
          batch-execute APPROVED decisions) live in the client component —
          server components cannot carry event handlers. RBAC is enforced
          server-side in the actions themselves (MANAGER+). */}
      <CeoDashboard data={data} role={user.role} />
    </>
  );
}
