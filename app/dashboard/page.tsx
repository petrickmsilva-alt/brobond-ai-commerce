import type { Metadata } from "next";
import { Package, Users, Megaphone, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Dashboard",
};

const kpis = [
  {
    label: "Produtos",
    value: "—",
    delta: "Aguardando dados",
    trend: "neutral" as const,
    icon: Package,
  },
  {
    label: "Creators",
    value: "—",
    delta: "Aguardando dados",
    trend: "neutral" as const,
    icon: Users,
  },
  {
    label: "Campanhas",
    value: "—",
    delta: "Aguardando dados",
    trend: "neutral" as const,
    icon: Megaphone,
  },
  {
    label: "Receita (30d)",
    value: "—",
    delta: "Aguardando dados",
    trend: "neutral" as const,
    icon: DollarSign,
  },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Visão geral do seu comércio social orientado a creators."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Performance de Campanhas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-surface-700 text-center">
              <BarChartPlaceholder />
              <p className="mt-3 text-sm text-white/40">
                Módulo de Analytics preparado — implementação no PR006.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Roadmap</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { id: "PR001", label: "Products CRUD", tone: "brand" as const },
              { id: "PR002", label: "Creators & TikTok", tone: "neutral" as const },
              { id: "PR003", label: "AI Assistant", tone: "neutral" as const },
              { id: "PR004", label: "Campaign Engine", tone: "neutral" as const },
              { id: "PR005", label: "Messaging", tone: "neutral" as const },
            ].map((item) => (
              <div key={item.id} className="flex items-center justify-between">
                <span className="text-sm text-white/70">{item.label}</span>
                <Badge tone={item.tone}>{item.id}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function BarChartPlaceholder() {
  const bars = [40, 65, 45, 80, 55, 70, 90];
  return (
    <div className="flex h-24 items-end gap-2">
      {bars.map((height, i) => (
        <div
          key={i}
          className="w-6 rounded-t bg-gradient-to-t from-brand-700 to-brand-500 opacity-40"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
