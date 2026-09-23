import type { Metadata } from "next";
import { CheckCheck, CircleAlert, Eye, ListOrdered, Send } from "lucide-react";
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
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Fila" value={String(data.kpis.queued)} icon={ListOrdered} />
        <KpiCard label="Enviadas" value={String(data.kpis.sent)} icon={Send} />
        <KpiCard label="Entregues" value={String(data.kpis.delivered)} icon={CheckCheck} />
        <KpiCard label="Lidas" value={String(data.kpis.read)} icon={Eye} />
        <KpiCard label="Falhas" value={String(data.kpis.failed)} icon={CircleAlert} />
      </div>

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
