import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Boxes, Clock3, PackageCheck, UsersRound } from "lucide-react";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { PageHeader } from "@/components/layout/page-header";
import { TikTokDashboard } from "@/components/tiktok/tiktok-dashboard";
import { isAdmin } from "@/lib/rbac";
import { requireOrganization, requireUser } from "@/lib/session";
import { tiktokDashboardService } from "@/modules/connectors/tiktok/dashboard.service";

export const metadata: Metadata = { title: "TikTok Shop" };

function formatDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
        new Date(value),
      )
    : "—";
}

/** TikTok Shop is infrastructure and OAuth is deliberately ADMIN-only. */
export default async function TikTokPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  if (!isAdmin(user.role)) redirect("/dashboard");

  const [data, raw] = await Promise.all([
    tiktokDashboardService.getDashboard(organizationId),
    searchParams,
  ]);
  const oauth = Array.isArray(raw.oauth) ? raw.oauth[0] : raw.oauth;

  return (
    <>
      <PageHeader
        title="TikTok Shop"
        description="Conector oficial TikTok Shop — OAuth server-side, tokens AES-256-GCM e sincronização idempotente."
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Conta conectada" value={String(data.connectedAccounts)} icon={Boxes} />
        <KpiCard
          label="Produtos sincronizados"
          value={String(data.synchronizedProducts)}
          icon={PackageCheck}
        />
        <KpiCard label="Creators" value={String(data.creators)} icon={UsersRound} />
        <KpiCard label="Última sincronização" value={formatDate(data.lastSync)} icon={Clock3} />
      </div>
      <TikTokDashboard data={data} oauth={oauth} />
    </>
  );
}
