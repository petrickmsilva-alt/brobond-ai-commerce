import type { Metadata } from "next";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { Users, Gauge, Crown, MessageSquare } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { CreatorsToolbar } from "@/components/creators/creators-toolbar";
import { CreatorsTable } from "@/components/creators/creators-table";
import { CreatorsPagination } from "@/components/creators/creators-pagination";
import { DiscoverCreatorsButton } from "@/components/creators/discover-creators-button";
import { CreateCreatorForm } from "@/components/creators/create-creator-form";
import { CreatorsKanban } from "@/components/creators/creators-kanban";
import { requireOrganization, requireUser } from "@/lib/session";
import { isAdmin, isManager } from "@/lib/rbac";
import {
  toCreatorPageDTO,
  toCreatorPipelineDTO,
  toCreatorStatsDTO,
} from "@/modules/creators/crm/dto/creator.dto";
import { creatorRepository } from "@/modules/creators/crm/repositories/creator-profile.repository";
import { creatorListQuerySchema } from "@/modules/creators/crm/validators/creator.validator";

export const metadata: Metadata = {
  title: "Creators",
};

/**
 * Creators dashboard (PR003 — Creator Discovery Engine).
 *
 * KPIs: Creators · Score Médio · Premium · Contatados.
 * Table: Avatar · Creator · Nicho · Seguidores · Score · Status — with
 * busca, filtros (nicho, status, origem), ordenação e paginação
 * (URL-state), responsivo.
 * Pipeline: Kanban simples com as seis colunas do CRM.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → executar descoberta · criar profile · mover pipeline
 *   MANAGER → criar profile · mover pipeline
 *   MEMBER  → somente leitura
 */
export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const query = creatorListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );

  const [{ items, total }, stats, pipeline] = await Promise.all([
    creatorRepository.listCreators(organizationId, query),
    creatorRepository.stats(organizationId),
    creatorRepository.pipeline(organizationId, { limitPerColumn: 8 }),
  ]);

  const pageData = toCreatorPageDTO(items, query.page, query.pageSize, total);
  const statsDTO = toCreatorStatsDTO(stats);
  const pipelineDTO = toCreatorPipelineDTO(pipeline);

  const canManage = isManager(user.role);
  const canDiscover = isAdmin(user.role);
  const isMember = user.role === UserRole.MEMBER;

  return (
    <>
      <PageHeader
        title="Creators"
        description="Creator Discovery Engine — CRM inteligente multi-source (TikTok, Instagram e Shopee plugam atrás da mesma factory)."
        actions={canDiscover ? <DiscoverCreatorsButton /> : undefined}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Creators" value={String(statsDTO.totalCreators)} icon={Users} />
        <KpiCard
          label="Score médio"
          value={statsDTO.averageScore !== null ? `${statsDTO.averageScore}/100` : "—"}
          icon={Gauge}
        />
        <KpiCard label="Premium" value={String(statsDTO.premiumCount)} icon={Crown} />
        <KpiCard label="Contatados" value={String(statsDTO.contactedCount)} icon={MessageSquare} />
      </div>

      {canManage && <CreateCreatorForm />}

      <Suspense>
        <CreatorsToolbar />
      </Suspense>

      <Card>
        <Suspense>
          <CreatorsTable items={pageData.items} />
          <CreatorsPagination
            page={pageData.page}
            totalPages={pageData.totalPages}
            total={pageData.total}
            pageSize={pageData.pageSize}
          />
        </Suspense>
      </Card>

      <div className="mt-8">
        <CreatorsKanban columns={pipelineDTO} canManage={canManage} />
      </div>

      {isMember && pageData.total === 0 && (
        <p className="mt-4 text-xs text-white/30">
          Somente leitura — a descoberta de creators é executada por um ADMIN do workspace.
        </p>
      )}
    </>
  );
}
