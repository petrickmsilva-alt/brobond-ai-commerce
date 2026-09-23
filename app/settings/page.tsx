import type { Metadata } from "next";
import { Building2, Plug, UserRound } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionCard } from "@/components/ui/section-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getShellContext } from "@/lib/shell-context";

export const metadata: Metadata = {
  title: "Configurações",
};

/**
 * Settings (PR010.1 — UI refresh).
 *
 * Restyled onto `SectionCard` and seeded with the real session values instead
 * of the hardcoded PR000 placeholders. No settings mutation ships here: the
 * fields stay read-only until a settings domain + server action exists, and
 * the disabled Save button says so rather than pretending to work.
 */
export default async function SettingsPage() {
  const { user, workspace, tiktokStatus } = await getShellContext();

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
        </SectionCard>

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
