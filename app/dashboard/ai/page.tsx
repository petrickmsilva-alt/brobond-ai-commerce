import type { Metadata } from "next";
import { Coins, Hash, MessageSquareText, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
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
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Mensagens geradas"
          value={String(kpis.totalMessages)}
          icon={MessageSquareText}
        />
        <KpiCard
          label="Tokens consumidos"
          value={(kpis.totalInputTokens + kpis.totalOutputTokens).toLocaleString("pt-BR")}
          icon={Hash}
        />
        <KpiCard
          label="Custo estimado"
          value={formatEstimatedCost(estimatedCostUsdCents)}
          icon={Coins}
        />
        <KpiCard label="Prompt version" value={latestPromptVersion} icon={Sparkles} />
      </div>
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
