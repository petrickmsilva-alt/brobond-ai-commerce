"use client";

import { useState, useTransition } from "react";
import { CircleAlert, Link2, Loader2, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  connectTikTokAction,
  disconnectTikTokAction,
  syncTikTokAction,
} from "@/app/dashboard/tiktok/actions";
import type { TikTokDashboardDTO } from "@/modules/connectors/tiktok/dto";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

const statusTone: Record<string, "success" | "warning" | "neutral"> = {
  CONNECTED: "success",
  EXPIRED: "warning",
  ERROR: "warning",
  DISCONNECTED: "neutral",
};

export function TikTokDashboard({ data, oauth }: { data: TikTokDashboardDTO; oauth?: string }) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(
    oauth === "connected"
      ? "Conta TikTok Shop conectada com sucesso."
      : oauth === "error"
        ? "Não foi possível concluir a autorização. Tente conectar novamente."
        : null,
  );

  function connect() {
    setFeedback(null);
    startTransition(async () => {
      const result = await connectTikTokAction();
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      // OAuth redirects away before any credential reaches the client.
      window.location.assign(result.data.authorizationUrl);
    });
  }

  function sync() {
    setFeedback(null);
    startTransition(async () => {
      const result = await syncTikTokAction();
      setFeedback(
        result.ok
          ? `Sincronização concluída: ${result.data.products.created} produtos novos, ${result.data.creators.created} creators novos.`
          : result.error,
      );
    });
  }

  function disconnect(accountId: string) {
    setFeedback(null);
    startTransition(async () => {
      const result = await disconnectTikTokAction({ accountId });
      setFeedback(result.ok ? "Credenciais locais removidas e conta desconectada." : result.error);
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={connect} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          Conectar TikTok
        </Button>
        <Button variant="outline" onClick={sync} disabled={pending || data.connectedAccounts === 0}>
          <RefreshCw className="h-4 w-4" />
          Sincronizar agora
        </Button>
      </div>

      {feedback && (
        <p className="flex items-center gap-2 text-sm text-white/70" role="status">
          <CircleAlert className="h-4 w-4 text-brand-300" />
          {feedback}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Contas conectadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.accounts.length === 0 ? (
              <p className="text-sm text-white/45">Nenhuma conta autorizada ainda.</p>
            ) : (
              data.accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-700/60 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {account.shopName ?? `Shop ${account.shopId}`}
                    </p>
                    <p className="text-xs text-white/40">
                      Shop ID: {account.shopId} · Último sync: {formatDate(account.lastSync)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={statusTone[account.status] ?? "neutral"}>{account.status}</Badge>
                    {account.status !== "DISCONNECTED" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => disconnect(account.id)}
                        disabled={pending}
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Desconectar
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Logs</CardTitle>
          </CardHeader>
          <CardContent>
            {data.logs.length === 0 ? (
              <p className="text-sm text-white/45">Nenhum evento registrado.</p>
            ) : (
              <ul className="space-y-3">
                {data.logs.map((log) => (
                  <li
                    key={log.id}
                    className="flex items-start justify-between gap-3 border-b border-surface-700/50 pb-3 last:border-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm text-white/80">
                        {log.action.replace(/^TIKTOK_/, "").replaceAll("_", " ")}
                      </p>
                      <p className="text-xs text-white/35">
                        {log.entityType}
                        {log.entityId ? ` · ${log.entityId}` : ""}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-white/40">
                      {formatDate(log.createdAt)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-center gap-2 text-xs text-white/35">
        <ShieldCheck className="h-4 w-4" />
        OAuth, sincronização e desconexão são executados exclusivamente no servidor. Tokens nunca
        são exibidos nesta tela.
      </p>
    </div>
  );
}
