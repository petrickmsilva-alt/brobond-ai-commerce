import type { Metadata } from "next";
import { Suspense } from "react";
import { Inbox, Link2, Sparkles, Timer } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { MatchTable } from "@/components/matches/match-table";
import { MatchToolbar } from "@/components/matches/match-toolbar";
import { MatchPagination } from "@/components/matches/match-pagination";
import { requireOrganization, requireUser } from "@/lib/session";
import { isManager } from "@/lib/rbac";
import {
  toProductMatchItemDTO,
  toProductMatchKpisDTO,
  toProductMatchPageDTO,
} from "@/modules/campaigns/dto/product-match.dto";
import { productMatchRepository } from "@/modules/campaigns/repositories/product-match.repository";
import { matchListQuerySchema } from "@/modules/campaigns/validators/product-match.validator";

export const metadata: Metadata = {
  title: "Matches",
};

/**
 * Matches dashboard (PR005.1 — Product Match Architecture).
 *
 * KPIs: Conteúdos importados · Matches automáticos · Pendentes (conteúdos
 * ainda sem nenhum match) · Confiança média.
 *
 * Table: Vídeo · Produto · Confidence · Origem · Status — ordenada por
 * confidence (desc), com busca e paginação em URL-state.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → criar · aprovar · remover
 *   MANAGER → criar · aprovar · remover
 *   MEMBER  → somente leitura
 *
 * Deterministic matching only — no OpenAI, no computer vision, no
 * embeddings, no TikTok integration.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const query = matchListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );

  const [{ items, total }, kpis] = await Promise.all([
    productMatchRepository.listMatches(organizationId, query),
    productMatchRepository.kpis(organizationId),
  ]);

  const kpiData = toProductMatchKpisDTO(kpis);
  const pageData = toProductMatchPageDTO(
    items.map(toProductMatchItemDTO),
    query.page,
    query.pageSize,
    total,
  );

  const canManage = isManager(user.role); // ADMIN + MANAGER

  return (
    <>
      <PageHeader
        title="Matches"
        description="Product Matching Engine — relaciona conteúdos externos importados aos produtos internos por regras determinísticas (sem IA, sem visão computacional, sem embeddings)."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Conteúdos importados"
          value={String(kpiData.importedContents)}
          icon={Inbox}
        />
        <KpiCard
          label="Matches automáticos"
          value={String(kpiData.automaticMatches)}
          icon={Sparkles}
        />
        <KpiCard label="Pendentes" value={String(kpiData.pendingContents)} icon={Timer} />
        <KpiCard
          label="Confiança média"
          value={kpiData.averageConfidence.toFixed(2)}
          icon={Link2}
        />
      </div>

      <h2 className="mb-3 text-sm font-medium text-white/70">
        Correspondências conteúdo ⇄ produto
      </h2>

      <Suspense>
        <MatchToolbar />
      </Suspense>

      <Card className="overflow-hidden p-0">
        <MatchTable items={pageData.items} canManage={canManage} />
        <MatchPagination
          page={pageData.page}
          totalPages={pageData.totalPages}
          total={pageData.total}
          pageSize={pageData.pageSize}
        />
      </Card>
    </>
  );
}
