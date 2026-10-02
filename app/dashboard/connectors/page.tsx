import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import {
  AlertTriangle,
  CircleCheck,
  CircleAlert,
  CopyCheck,
  DownloadCloud,
  Plug,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ConnectorsGrid } from "@/components/dashboard/connectors-grid";
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
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import {
  CONNECTOR_PROVIDER_LABELS,
  isConnectorProviderName,
} from "@/modules/marketplace/core/providers";

export const metadata: Metadata = {
  title: "Conectores",
};

/**
 * Connectors dashboard (PR005 framework · PR012 real integrations).
 *
 * Marketplaces & Pagamentos: six real provider cards (TikTok Shop,
 * Instagram Shopping, Shopee, Nuvemshop, Mercado Livre, Mercado Pago) with OAuth2 /
 * API-key connect, live sync and consolidated counters.
 *
 * KPIs: Importados · Duplicados · Falhas · Conectores ativos.
 * Table: conteúdo externo importado — busca, filtros (plataforma, status,
 * tipo), ordenação e paginação em URL-state, responsivo.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → conectar · sincronizar · ativar/desativar · testar
 *   MANAGER → visualizar
 *   MEMBER  → somente leitura
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

  const [{ items, total }, kpis, statuses, marketplaceCards] = await Promise.all([
    connectorRepository.listContent(organizationId, query),
    connectorRepository.kpis(organizationId),
    connectorRepository.listStatuses(organizationId),
    marketplaceService.listConnectorCards(organizationId),
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

  // OAuth feedback banner (set by the provider callback redirects).
  const oauthResult = typeof raw.oauth === "string" ? raw.oauth : undefined;
  const oauthProviderRaw = typeof raw.provider === "string" ? raw.provider.toUpperCase() : "";
  const oauthProvider = isConnectorProviderName(oauthProviderRaw)
    ? CONNECTOR_PROVIDER_LABELS[oauthProviderRaw]
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Canais de Venda"
        title="Conectores — Hub Multicanal"
        description="Centralize suas vendas em um só lugar: TikTok Shop, Instagram Shopping, Shopee, Nuvemshop, Mercado Livre e Mercado Pago — conexão OAuth2 / API keys, sincronização real e contadores consolidados por plataforma."
      />

      {oauthResult === "connected" && (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
        >
          <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" />
          {oauthProvider
            ? `${oauthProvider} conectado com sucesso. As credenciais foram criptografadas e já podem sincronizar.`
            : "Conector conectado com sucesso."}
        </p>
      )}
      {oauthResult === "error" && (
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {oauthProvider
            ? `Não foi possível conectar ${oauthProvider}. Verifique as credenciais do aplicativo e tente novamente.`
            : "Não foi possível concluir a conexão. Tente novamente."}
        </p>
      )}

      <h2 className="mb-3 text-sm font-medium text-white/70">Marketplaces & Pagamentos</h2>
      <ConnectorsGrid connectors={marketplaceCards} canManage={canManage} />

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
