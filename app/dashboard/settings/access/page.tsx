import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Badge } from "@/components/ui/badge";
import { AccessRequestsTable } from "@/components/settings/access-requests-table";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/rbac";
import { accessRequestService } from "@/modules/auth/access-request.service";

export const metadata: Metadata = {
  title: "Solicitações de acesso",
};

/**
 * Access-request administration — `/dashboard/settings/access` (PR010.3 §2).
 *
 * "Somente ADMIN": the page renders a restricted state for MANAGER/MEMBER
 * instead of throwing (the middleware already guarantees a session; the role
 * gate here is about what the queue exposes). The REAL enforcement is
 * `requireAdmin()` inside every server action — hiding the buttons is an
 * affordance, not a control, so a MANAGER replaying the action by hand gets
 * an `AuthorizationError` and nothing changes.
 *
 * Data is read only for ADMINs: a MANAGER's render never touches the queue.
 *
 * §2 — "Ao aprovar: Criar Invitation": the Aprovar button reviews the request
 * AND issues + delivers the invitation in one action. The invite URL is
 * shown once (copy affordance) because the raw token is never persisted.
 */
export default async function AccessSettingsPage() {
  const user = await getCurrentUser();
  const canManage = Boolean(user && isAdmin(user.role));

  if (!canManage) {
    return (
      <>
        <PageHeader
          eyebrow="System"
          title="Solicitações de acesso"
          description="Revisão de pedidos enviados pelo formulário público."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Configurações", href: "/settings" },
            { label: "Acesso" },
          ]}
        />
        <SectionCard
          title="Acesso restrito"
          description="Somente administradores podem revisar solicitações de acesso."
          icon={ShieldCheck}
        >
          <p className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/45">
            A fila de solicitações, a aprovação de pedidos e o envio de convites são operações de
            ADMIN. Se você precisa gerenciar acessos, fale com o administrador do seu workspace.
          </p>
        </SectionCard>
      </>
    );
  }

  const [requests, counts] = await Promise.all([
    accessRequestService.list({ take: 50 }),
    accessRequestService.counts(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Solicitações de acesso"
        description="Aprove ou recuse pedidos de acesso. Aprovar cria e envia automaticamente um convite de uso único."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Configurações", href: "/settings" },
          { label: "Acesso" },
        ]}
        actions={
          counts.pending > 0 ? (
            <Badge tone="warning" dot>
              {counts.pending} pendente{counts.pending > 1 ? "s" : ""}
            </Badge>
          ) : (
            <Badge tone="neutral">Em dia</Badge>
          )
        }
      />

      <div className="grid max-w-5xl gap-4">
        <SectionCard
          title="Fila de solicitações"
          description="Pedidos enviados pelo formulário público /request-access. Aprovar emite um convite (papel MEMBER) e envia o link por email."
          icon={UserCheck}
        >
          <AccessRequestsTable
            requests={requests}
            pendingCount={counts.pending}
            canManage={canManage}
          />
        </SectionCard>

        <p className="flex items-center gap-2 text-[11px] leading-relaxed text-white/35">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Convites são de uso único, expiram em 7 dias e o link é entregue por email. Gerencie os
          convites emitidos em{" "}
          <Link
            href="/settings"
            className="font-medium text-brand-300 underline-offset-4 transition-colors hover:text-brand-200 hover:underline"
          >
            Configurações
          </Link>
          .
        </p>
      </div>
    </>
  );
}
