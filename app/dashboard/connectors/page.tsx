import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { AlertTriangle, CopyCheck, DownloadCloud, Plug } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ConnectorCard } from "@/components/connectors/connector-card";
import { ContentTable } from "@/components/connectors/content-table";
import { ContentToolbar } from "@/components/connectors/content-toolbar";
import { ContentPagination } from "@/components/connectors/content-pagination";
import { requireOrganization, requireUser } from "@/lib/session";
import { isAdmin } from "@/lib/rbac";
import {
  toConnectorStatusDTO,
  toExternalContentPageDTO,
  type ConnectorKpisDTO,
} from "@/modules/connectors/core/connector.dto";
import { getAllConnectors } from "@/modules/connectors/core/connector.factory";
import { connectorRepository } from "@/modules/connectors/core/connector.repository";
import { contentListQuerySchema } from "@/modules/connectors/core/connector.validator";

export const metadata: Metadata = {
  title: "Conectores",
};

/**
 * Connectors dashboard (PR005 — Connector Framework).
 *
 * KPIs: Importados · Duplicados · Falhas · Conectores ativos.
 * Grid: one card per registered connector (state, counters, ADMIN actions).
 * Table: conteúdo externo importado — busca, filtros (plataforma, status,
 * tipo), ordenação e paginação em URL-state, responsivo.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → sincronizar · ativar/desativar · testar conector
 *   MANAGER → visualizar
 *   MEMBER  → somente leitura
 *
 * NO real API is integrated: MOCK is the only implemented connector and the
 * other three are placeholders — syncing them records an ERROR state.
 */
export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const query = contentListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );

  const [{ items, total }, kpis, statuses] = await Promise.all([
    connectorRepository.listContent(organizationId, query),
    connectorRepository.kpis(organizationId),
    connectorRepository.listStatuses(organizationId),
  ]);

  // The factory is the source of truth for WHICH connectors exist; the
  // database only adds per-tenant state on top of it. A platform that was
  // never synced still renders (IDLE, zeroed counters).
  const descriptors = getAllConnectors();
  const byPlatform = new Map(statuses.map((status) => [status.platform, status]));
  const connectors = descriptors.map((connector) =>
    toConnectorStatusDTO(
      { platform: connector.platform, name: connector.name, implemented: connector.implemented },
      byPlatform.get(connector.platform) ?? null,
    ),
  );

  const kpiData: ConnectorKpisDTO = {
    imported: kpis.imported,
    duplicates: kpis.duplicates,
    failed: kpis.failed,
    activeConnectors: kpis.activeConnectors,
    totalConnectors: descriptors.length,
  };

  const pageData = toExternalContentPageDTO(items, query.page, query.pageSize, total);

  const canManage = isAdmin(user.role);
  const isMember = user.role === UserRole.MEMBER;

  return (
    <>
      <PageHeader
        title="Conectores"
        description="Connector Framework — arquitetura multi-plataforma para importar conteúdo externo. Mock implementado; TikTok, Instagram e Shopee são placeholders (nenhuma API real integrada)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Importados" value={String(kpiData.imported)} icon={DownloadCloud} />
        <KpiCard label="Duplicados" value={String(kpiData.duplicates)} icon={CopyCheck} />
        <KpiCard label="Falhas" value={String(kpiData.failed)} icon={AlertTriangle} />
        <KpiCard
          label="Conectores ativos"
          value={`${kpiData.activeConnectors}/${kpiData.totalConnectors}`}
          icon={Plug}
        />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {connectors.map((connector) => (
          <ConnectorCard key={connector.platform} connector={connector} canManage={canManage} />
        ))}
      </div>

      <h2 className="mb-3 text-sm font-medium text-white/70">Conteúdo importado</h2>

      <Suspense>
        <ContentToolbar />
      </Suspense>

      <Card>
        <Suspense>
          <ContentTable items={pageData.items} />
          <ContentPagination
            page={pageData.page}
            totalPages={pageData.totalPages}
            total={pageData.total}
            pageSize={pageData.pageSize}
          />
        </Suspense>
      </Card>

      {isMember && pageData.total === 0 && (
        <p className="mt-4 text-xs text-white/30">
          Somente leitura — a sincronização de conectores é executada por um ADMIN do workspace.
        </p>
      )}
    </>
  );
}
