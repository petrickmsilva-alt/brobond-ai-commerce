import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { CalendarClock, Hash, Layers, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { TrendsToolbar } from "@/components/trends/trends-toolbar";
import { TrendsTable } from "@/components/trends/trends-table";
import { TrendsPagination } from "@/components/trends/trends-pagination";
import { CollectTrendsButton } from "@/components/trends/collect-trends-button";
import { CreateTrendForm } from "@/components/trends/create-trend-form";
import { requireOrganization, requireUser } from "@/lib/session";
import { isAdmin } from "@/lib/rbac";
import { toTrendSnapshotDTO, type TrendPageDTO } from "@/modules/trends/dto/create-trend.dto";
import { trendRepository } from "@/modules/trends/repositories/trend.repository";
import { trendListQuerySchema } from "@/modules/trends/validators/trend.validator";

export const metadata: Metadata = {
  title: "Trends",
};

/** Format the last collection timestamp for the pt-BR dashboard. */
function formatLastCollected(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

/**
 * Trends dashboard (PR002 — Trend Hunter AI).
 *
 * KPIs: Maior Score · Keywords · Categorias · Última Coleta.
 * Table: Keyword · Categoria · Views · Likes · Score — with busca, filtro
 * por categoria, ordenação e paginação (URL-state), responsivo.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → executar coleta · criar snapshot
 *   MANAGER → visualizar
 *   MEMBER  → somente leitura
 */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const query = trendListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );

  const [{ items, total }, stats] = await Promise.all([
    trendRepository.listSnapshots(organizationId, query),
    trendRepository.stats(organizationId),
  ]);

  const pageData: TrendPageDTO = {
    items: items.map(toTrendSnapshotDTO),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };

  const canManage = isAdmin(user.role);
  const isMember = user.role === UserRole.MEMBER;

  return (
    <>
      <PageHeader
        title="Trends"
        description="Trend Hunter AI — tendências coletadas, classificadas e priorizadas por score."
        actions={canManage ? <CollectTrendsButton /> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Maior score"
          value={stats.maxScore !== null ? `${stats.maxScore}/100` : "—"}
          icon={TrendingUp}
        />
        <KpiCard label="Keywords" value={String(stats.keywordCount)} icon={Hash} />
        <KpiCard label="Categorias" value={String(stats.categoryCount)} icon={Layers} />
        <KpiCard
          label="Última coleta"
          value={formatLastCollected(
            stats.lastCollectedAt ? stats.lastCollectedAt.toISOString() : null,
          )}
          icon={CalendarClock}
        />
      </div>

      {canManage && <CreateTrendForm />}

      <Suspense>
        <TrendsToolbar />
      </Suspense>

      <Card>
        <Suspense>
          <TrendsTable items={pageData.items} />
          <TrendsPagination
            page={pageData.page}
            totalPages={pageData.totalPages}
            total={pageData.total}
            pageSize={pageData.pageSize}
          />
        </Suspense>
      </Card>

      {isMember && pageData.total === 0 && (
        <p className="mt-4 text-xs text-white/30">
          Somente leitura — a coleta de tendências é executada por um ADMIN do workspace.
        </p>
      )}
    </>
  );
}
