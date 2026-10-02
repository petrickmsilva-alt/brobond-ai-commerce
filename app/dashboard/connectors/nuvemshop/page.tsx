import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, KeyRound, Webhook } from "lucide-react";
import { requireOrganization } from "@/lib/session";
import { connectorOAuthStateService } from "@/modules/marketplace/core/oauth-state.service";
import { buildNuvemshopAuthorizationUrl } from "@/modules/connectors/nuvemshop";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Nuvemshop — Conectores" };

export default async function NuvemshopConnectorPage() {
  const organizationId = await requireOrganization();
  const state = await connectorOAuthStateService.issue(organizationId, "NUVEMSHOP");
  const authorizationUrl = buildNuvemshopAuthorizationUrl(state);
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Canais de Venda" title="Nuvemshop" description="Conecte sua loja e centralize pedidos, vendas e receita no Brobond Wear." />
      <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
        <CardContent className="grid gap-8 p-8 md:grid-cols-[1.2fr_0.8fr] md:p-10">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Integração oficial</p>
            <h2 className="text-2xl font-semibold text-white">Sua operação, em um só painel.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/60">A autorização usa OAuth 2.0 e o token é armazenado criptografado no servidor. O Brobond Wear não pede nem expõe sua senha.</p>
            <Link href={authorizationUrl} className="mt-7 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400">Conectar minha loja <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="space-y-3">
            {[
              { icon: KeyRound, label: "Token de longa duração" },
              { icon: Webhook, label: "Pedidos recebidos por webhook" },
              { icon: CheckCircle2, label: "Upsert idempotente de vendas" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/10 p-4 text-sm text-white/75">
                <Icon className="h-5 w-5 text-brand-300" />
                {label}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
