import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Send, Sparkles } from "lucide-react";
import { UserRole } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { OutreachWorkbench } from "@/components/outreach/outreach-workbench";
import { requireOrganization, requireUser } from "@/lib/session";
import { isAdmin, isManager } from "@/lib/rbac";
import { outboxRepository } from "@/modules/outreach/queue/outbox.repository";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Outreach AI" };

export default async function OutreachPage() {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  const [outbox, stats, creators, products, campaigns, templates] = await Promise.all([
    outboxRepository.listOutbox(organizationId, { pageSize: 100 }),
    outboxRepository.stats(organizationId),
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
    prisma.messageTemplate.findMany({
      where: { organizationId },
      select: { id: true, name: true },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Outreach AI"
        description="Prompt Engine por templates, cadências e outbox — sem envio real ou integração externa."
        actions={
          <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            AI cadence
          </Badge>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Rascunhos" value={String(stats.DRAFT)} icon={FileText} />
        <KpiCard label="Prontas" value={String(stats.READY)} icon={CheckCircle2} />
        <KpiCard label="Agendadas" value={String(stats.SCHEDULED)} icon={CalendarClock} />
        <KpiCard label="Enviadas" value={String(stats.SENT)} icon={Send} />
        <KpiCard label="Falhas" value={String(stats.FAILED)} icon={AlertTriangle} />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Biblioteca de campanha
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {stats.READY + stats.SCHEDULED} mensagens prontas para ativação
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <Badge tone="success" size="sm">
              {stats.SENT} enviadas
            </Badge>
            <Badge tone="warning" size="sm">
              {stats.FAILED} falhas
            </Badge>
          </div>
        </div>
      </Card>

      <OutreachWorkbench
        messages={outbox.items.map((message) => ({
          id: message.id,
          creator: message.creator.displayName,
          product: message.product.name,
          template: message.template.name,
          status: message.status,
          scheduledFor: message.scheduledFor?.toISOString() ?? null,
          generatedText: message.generatedText,
        }))}
        creators={creators.map((item) => ({ id: item.id, name: item.displayName }))}
        products={products}
        campaigns={campaigns}
        templates={templates}
        canManage={isManager(user.role)}
        canCancel={isAdmin(user.role)}
      />
      {user.role === UserRole.MEMBER && (
        <p className="mt-4 text-xs text-white/35">
          Somente leitura — geração e agendamento exigem MANAGER; cancelamento exige ADMIN.
        </p>
      )}
    </>
  );
}
