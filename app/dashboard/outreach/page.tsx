import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, CheckCircle2, FileText, Send } from "lucide-react";
import { UserRole } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
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
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Rascunhos" value={String(stats.DRAFT)} icon={FileText} />
        <KpiCard label="Prontas" value={String(stats.READY)} icon={CheckCircle2} />
        <KpiCard label="Agendadas" value={String(stats.SCHEDULED)} icon={CalendarClock} />
        <KpiCard label="Enviadas" value={String(stats.SENT)} icon={Send} />
        <KpiCard label="Falhas" value={String(stats.FAILED)} icon={AlertTriangle} />
      </div>
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
