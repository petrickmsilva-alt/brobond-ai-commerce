import type { Metadata } from "next";
import { CheckCheck, CircleAlert, Eye, ListOrdered, Send, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { DeliveryDashboard } from "@/components/delivery/delivery-dashboard";
import { requireOrganization, requireUser } from "@/lib/session";
import { deliveryDashboardService } from "@/modules/delivery/dashboard.service";
import { deliveryFiltersSchema, type DeliveryFiltersInput } from "@/modules/delivery/validators";

export const metadata: Metadata = { title: "Delivery Omnichannel" };

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read-only for every authenticated role (MEMBER included) — RBAC §10.
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const filters: DeliveryFiltersInput = deliveryFiltersSchema.parse({
    channel: one(raw.channel),
    status: one(raw.status),
    campaignId: one(raw.campaignId),
    page: one(raw.page),
    pageSize: one(raw.pageSize),
  });

  const [data, messages] = await Promise.all([
    deliveryDashboardService.getDashboard(organizationId),
    deliveryDashboardService.listMessages(organizationId, filters),
  ]);

  return (
    <>
      <PageHeader
        title="Delivery Omnichannel"
        description="Motor de entrega oficial Meta — Instagram Business e WhatsApp Cloud API, fila idempotente com retry exponencial."
        actions={
          <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            Delivery live
          </Badge>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Fila" value={String(data.kpis.queued)} icon={ListOrdered} />
        <KpiCard label="Enviadas" value={String(data.kpis.sent)} icon={Send} />
        <KpiCard label="Entregues" value={String(data.kpis.delivered)} icon={CheckCheck} />
        <KpiCard label="Lidas" value={String(data.kpis.read)} icon={Eye} />
        <KpiCard label="Falhas" value={String(data.kpis.failed)} icon={CircleAlert} />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Execução operacional
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {data.kpis.delivered + data.kpis.read} mensagens com atividade exitosa
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="success" size="sm">
              {data.kpis.delivered} entregues
            </Badge>
            <Badge tone="warning" size="sm">
              {data.kpis.failed} falhas
            </Badge>
          </div>
        </div>
      </Card>

      <DeliveryDashboard
        data={data}
        messages={messages}
        filters={filters}
        role={user.role}
        oauth={one(raw.oauth)}
      />
    </>
  );
}
