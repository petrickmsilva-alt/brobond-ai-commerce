import type { Metadata } from "next";
import { BarChart3, Package, Sparkles, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CampaignAudienceTable } from "@/components/campaigns/campaign-audience-table";
import { requireOrganization } from "@/lib/session";
import { campaignAudienceRepository } from "@/modules/campaigns/repositories/campaign-audience.repository";
import { estimateROI } from "@/modules/campaigns/roi/roi";

export const metadata: Metadata = { title: "Campanhas" };

export default async function CampaignsPage() {
  const organizationId = await requireOrganization();
  const rows = await campaignAudienceRepository.listRecommendations(organizationId);
  const creators = new Set(rows.map((row) => row.creatorId));
  const products = new Set(rows.map((row) => row.productId));
  const averageScore = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.matchScore, 0) / rows.length)
    : 0;
  const estimates = rows.map((row) => {
    const units = Math.max(1, Math.round(row.creator.avgViews * 0.005));
    return estimateROI({
      predictedRevenueCents: row.product.priceCents * units,
      marginPercent: row.product.marginBps / 100,
      commissionPercent: 10,
      freightCents: 1_500 * units,
    });
  });
  const predictedRoi = estimates.length
    ? Math.round(estimates.reduce((sum, value) => sum + value.roiPercent, 0) / estimates.length)
    : 0;

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Campaign Engine — creators elegíveis e produtos ranqueados por matching determinístico, sem chamadas a provedores externos."
        actions={
          <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3 w-3" />
            Matching ativo
          </Badge>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Creators Recomendados" value={String(creators.size)} icon={Users} />
        <KpiCard label="Produtos" value={String(products.size)} icon={Package} />
        <KpiCard label="Score Médio" value={`${averageScore}/100`} icon={Sparkles} />
        <KpiCard label="ROI Previsto" value={`${predictedRoi}%`} icon={BarChart3} />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Performance estimada
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {rows.filter((row) => row.recommended).length} recomendações com potencial de escala
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="success" size="sm">
              {predictedRoi}% ROI
            </Badge>
            <Badge tone="info" size="sm">
              {averageScore}/100 score
            </Badge>
          </div>
        </div>
      </Card>

      <h2 className="mb-3 text-sm font-medium text-white/70">Audiência recomendada</h2>
      <Card className="overflow-hidden p-0" variant="default">
        <CampaignAudienceTable
          items={rows.map((row) => ({
            id: row.id,
            creator: row.creator.displayName,
            handle: row.creator.handle,
            product: row.product.name,
            matchScore: row.matchScore,
            niche: row.creator.niche,
            recommended: row.recommended,
          }))}
        />
      </Card>
    </>
  );
}
