import type { Metadata } from "next";
import { Coins, Hash, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { AiWorkbench } from "@/components/ai/ai-workbench";
import { requireOrganization, requireUser } from "@/lib/session";
import { isManager } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { aiMessageRepository } from "@/modules/ai/repositories/ai-message.repository";
import { readGeneratedContent } from "@/modules/ai/personalization/message.service";
import { estimateCostUsdCents, formatEstimatedCost } from "@/modules/ai/openai/pricing";
import { listPromptDefinitions } from "@/modules/ai/openai/prompts";

export const metadata: Metadata = { title: "IA — Personalização" };

export default async function AiPage() {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const [kpis, listing, creators, products, campaigns] = await Promise.all([
    aiMessageRepository.kpis(organizationId),
    aiMessageRepository.list(organizationId, { pageSize: 50 }),
    prisma.creatorProfile.findMany({
      where: { organizationId },
      select: { id: true, displayName: true },
      orderBy: { creatorScore: "desc" },
      take: 100,
    }),
    prisma.product.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.campaign.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const estimatedCostUsdCents = listing.items.reduce(
    (total, item) => total + estimateCostUsdCents(item.model, item.inputTokens, item.outputTokens),
    0,
  );
  const latestPromptVersion = listing.items[0]?.promptVersion ?? "—";

  return (
    <>
      <PageHeader
        title="IA — Personalização"
        description="Geração de conteúdo comercial personalizado via OpenAI Responses API — apenas geração e versionamento, sem envio."
        actions={
          <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            AI workflow
          </Badge>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Tokens de API"
          value={(kpis.totalInputTokens + kpis.totalOutputTokens).toLocaleString("pt-BR")}
          icon={Hash}
        />
        <KpiCard
          label="Custo de API"
          value={formatEstimatedCost(estimatedCostUsdCents)}
          icon={Coins}
        />
        <KpiCard label="Versão do prompt" value={latestPromptVersion} icon={Sparkles} />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Consumo da API
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {formatEstimatedCost(estimatedCostUsdCents)} em chamadas de personalização
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="success" size="sm">
              {latestPromptVersion}
            </Badge>
            <Badge tone="info" size="sm">
              {kpis.totalInputTokens + kpis.totalOutputTokens} tokens
            </Badge>
          </div>
        </div>
      </Card>

      <AiWorkbench
        messages={listing.items.map((item) => ({
          id: item.id,
          creator: item.creatorProfile.displayName,
          product: item.product.name,
          campaign: item.campaign.name,
          tone: item.tone,
          promptVersion: item.promptVersion,
          model: item.model,
          inputTokens: item.inputTokens,
          outputTokens: item.outputTokens,
          createdAt: item.createdAt.toISOString(),
          content: readGeneratedContent(item),
        }))}
        creators={creators.map((item) => ({ id: item.id, name: item.displayName }))}
        products={products}
        campaigns={campaigns}
        tones={listPromptDefinitions().map((prompt) => prompt.tone)}
        canGenerate={isManager(user.role)}
      />
    </>
  );
}
