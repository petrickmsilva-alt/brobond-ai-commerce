import type { Metadata } from "next";
import { Building2, Plug, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InvitationsPanel } from "@/components/settings/invitations-panel";
import { AccessRequestsPanel } from "@/components/settings/access-requests-panel";
import { getShellContext } from "@/lib/shell-context";
import { requireUser } from "@/lib/session";
import { isAdmin } from "@/lib/rbac";
import { invitationService } from "@/modules/auth/invitation.service";
import { accessRequestService } from "@/modules/auth/access-request.service";

export const metadata: Metadata = {
  title: "Configurações",
};

/**
 * Settings (PR010.1 UI refresh · PR010.2 §5/§7/§11 administration).
 *
 * PR010.2 adds the two ADMIN surfaces the auth flows need a home for:
 * the invitation manager (§7) and the access-request queue (§5).
 *
 * RBAC §11 — resolved once here and passed down as `canManage`:
 *   ADMIN   → gerencia convites · aprova acesso
 *   MANAGER → sem convites (panels render read-only)
 *   MEMBER  → leitura
 *
 * The flag only governs affordances. Every mutation re-checks with
 * `requireAdmin()` server-side (`app/settings/actions.ts`), so hiding a button
 * is never the thing standing between a MANAGER and an invitation.
 *
 * The ADMIN-only data is fetched only for an ADMIN — a MANAGER's render never
 * even reads the access-request queue.
 */
export default async function SettingsPage() {
  const { user, workspace, tiktokStatus } = await getShellContext();
  const current = await requireUser();
  const canManage = isAdmin(current.role);

  // Invitations are tenant-scoped and visible to the workspace; access
  // requests are global and ADMIN-only, so they are read conditionally.
  const [invitations, accessRequests, accessCounts] = await Promise.all([
    current.organizationId
      ? invitationService.list(current.organizationId)
      : Promise.resolve([]),
    canManage ? accessRequestService.list({ take: 25 }) : Promise.resolve([]),
    canManage
      ? accessRequestService.counts()
      : Promise.resolve({ pending: 0, approved: 0, rejected: 0, total: 0 }),
  ]);

  const integrations = [
    {
      name: "TikTok Shop",
      description: "OAuth oficial, sincronização de produtos e creators.",
      connected: tiktokStatus === "connected",
      href: "/dashboard/tiktok",
    },
    {
      name: "Conectores de conteúdo",
      description: "Importação de conteúdo externo por plataforma.",
      connected: false,
      href: "/dashboard/connectors",
    },
    {
      name: "Delivery omnichannel",
      description: "Instagram e WhatsApp via APIs oficiais da Meta.",
      connected: false,
      href: "/dashboard/delivery",
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="System"
        title="Configurações"
        description="Gerencie sua conta, workspace e integrações."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Configurações" }]}
      />

      <div className="grid max-w-4xl gap-4">
        <SectionCard
          title="Perfil"
          description="Os dados da sua conta, resolvidos pela sessão."
          icon={UserRound}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="profile-name" className="text-xs font-medium text-white/60">
                Nome
              </label>
              <Input id="profile-name" defaultValue={user.name} readOnly />
            </div>
            <div className="grid gap-2">
              <label htmlFor="profile-email" className="text-xs font-medium text-white/60">
                Email
              </label>
              <Input id="profile-email" type="email" defaultValue={user.email} readOnly />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button disabled aria-describedby="profile-hint">
              Salvar alterações
            </Button>
            <p id="profile-hint" className="text-xs text-white/40">
              A edição de perfil será habilitada com o domínio de configurações.
            </p>
          </div>
        </SectionCard>

        <SectionCard
          title="Workspace"
          description="A organização à qual sua sessão está vinculada."
          icon={Building2}
          actions={<Badge tone="brand">{user.role}</Badge>}
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-white/40">Nome</dt>
              <dd className="mt-1 text-sm text-white">{workspace.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-white/40">
                Seu papel
              </dt>
              <dd className="mt-1 text-sm text-white">{user.role}</dd>
            </div>
          </dl>

          {/* RBAC §11, stated plainly where the role is shown. */}
          <p className="mt-5 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-white/45">
            <strong className="font-semibold text-white/65">ADMIN</strong> gerencia convites e
            aprova solicitações de acesso ·{" "}
            <strong className="font-semibold text-white/65">MANAGER</strong> opera o workspace, sem
            convites · <strong className="font-semibold text-white/65">MEMBER</strong> tem acesso de
            leitura.
          </p>
        </SectionCard>

        {/* §7 — Convites (ADMIN gerencia; demais papéis apenas visualizam). */}
        <InvitationsPanel invitations={invitations} canManage={canManage} />

        {/* §5 — Fila de solicitações de acesso, exclusiva do ADMIN. */}
        {canManage && (
          <AccessRequestsPanel
            requests={accessRequests}
            pendingCount={accessCounts.pending}
            canManage={canManage}
          />
        )}

        <SectionCard
          title="Integrações"
          description="Estado das conexões externas deste workspace."
          icon={Plug}
        >
          <ul className="space-y-3">
            {integrations.map((integration) => (
              <li
                key={integration.name}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{integration.name}</p>
                  <p className="mt-0.5 truncate text-xs text-white/45">{integration.description}</p>
                </div>
                <Badge tone={integration.connected ? "success" : "neutral"} dot>
                  {integration.connected ? "Conectado" : "Não conectado"}
                </Badge>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </>
  );
}
