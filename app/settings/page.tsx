import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Configurações",
};

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Gerencie sua conta, workspace e integrações."
      />

      <div className="grid max-w-3xl gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <label className="text-xs font-medium text-white/60">Nome</label>
              <Input defaultValue="Brobond Admin" />
            </div>
            <div className="grid gap-2">
              <label className="text-xs font-medium text-white/60">Email</label>
              <Input type="email" defaultValue="admin@brobond.ai" />
            </div>
            <Button className="w-fit">Salvar alterações</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { name: "TikTok API", pr: "PR003 / PR005" },
              { name: "OpenAI", pr: "PR004" },
              { name: "Analytics Pipeline", pr: "PR007" },
            ].map((integration) => (
              <div
                key={integration.name}
                className="flex items-center justify-between rounded-lg border border-surface-700 bg-surface-900 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-white">{integration.name}</p>
                  <p className="text-xs text-white/40">Reservado para {integration.pr}</p>
                </div>
                <Badge tone="warning">Não implementado</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
