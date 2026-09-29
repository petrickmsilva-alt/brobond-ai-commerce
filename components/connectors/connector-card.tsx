"use client";

import { useState, useTransition } from "react";
import {
  CircleAlert,
  CircleCheck,
  Loader2,
  Plug,
  Power,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectorStateBadge } from "./connector-state-badge";
import type { ConnectorStatusDTO } from "@/modules/connectors/core/connector.dto";
import {
  syncConnectorAction,
  testConnectorAction,
  toggleConnectorAction,
} from "@/app/dashboard/connectors/actions";

/**
 * One connector card: platform, state, counters and the ADMIN affordances
 * (sincronizar · ativar/desativar · testar). Every action re-asserts
 * `requireAdmin()` server-side — these buttons are affordances only.
 *
 * A placeholder platform renders the "não implementado" badge and its sync
 * is expected to fail (recorded as an ERROR state, never a crash).
 */
interface ConnectorCardProps {
  connector: ConnectorStatusDTO;
  canManage: boolean;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function ConnectorCard({ connector, canManage }: ConnectorCardProps) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function runSync() {
    setFeedback(null);
    startTransition(async () => {
      const result = await syncConnectorAction({ platform: connector.platform });
      setFeedback(
        result.ok
          ? {
              ok: true,
              message: `${result.data.imported} importados · ${result.data.duplicates} duplicados · ${result.data.failed} falhas.`,
            }
          : { ok: false, message: result.error },
      );
    });
  }

  function toggle() {
    setFeedback(null);
    startTransition(async () => {
      const result = await toggleConnectorAction({
        platform: connector.platform,
        enabled: !connector.enabled,
      });
      setFeedback(
        result.ok
          ? {
              ok: true,
              message: result.data.enabled ? "Conector ativado." : "Conector desativado.",
            }
          : { ok: false, message: result.error },
      );
    });
  }

  function test() {
    setFeedback(null);
    startTransition(async () => {
      const result = await testConnectorAction(connector.platform);
      setFeedback(
        result.ok
          ? { ok: result.data.ok, message: result.data.message }
          : { ok: false, message: result.error },
      );
    });
  }

  return (
    <Card>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600/15 text-brand-300">
              <Plug className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{connector.name}</p>
              <p className="text-xs text-white/40">{connector.platform}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <ConnectorStateBadge state={connector.state} />
            {!connector.implemented && <Badge tone="neutral">placeholder</Badge>}
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Importados</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.importedCount}
            </dd>
          </div>
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Duplicados</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.duplicateCount}
            </dd>
          </div>
          <div className="rounded-lg border border-surface-700/60 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-white/35">Falhas</dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {connector.failedCount}
            </dd>
          </div>
        </dl>

        <div className="space-y-1 text-xs text-white/40">
          <p>
            Última sincronização:{" "}
            <span className="text-white/60">{formatDateTime(connector.lastSyncAt)}</span>
            {connector.syncCount > 0 && <span> · {connector.syncCount} execução(ões)</span>}
          </p>
          {connector.lastError && (
            <p className="line-clamp-2 text-amber-300/80">{connector.lastError}</p>
          )}
        </div>

        {canManage ? (
          <div className="mt-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={runSync} disabled={isPending}>
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sincronizar
            </Button>
            <Button size="sm" variant="outline" onClick={toggle} disabled={isPending}>
              <Power className="h-3.5 w-3.5" />
              {connector.enabled ? "Desativar" : "Ativar"}
            </Button>
            <Button size="sm" variant="ghost" onClick={test} disabled={isPending}>
              <Stethoscope className="h-3.5 w-3.5" />
              Testar
            </Button>
          </div>
        ) : (
          <p className="mt-auto text-xs text-white/30">
            Somente leitura — sincronização e ativação exigem ADMIN.
          </p>
        )}

        {feedback && (
          <p
            className={
              feedback.ok
                ? "flex items-start gap-1.5 text-xs text-emerald-400"
                : "flex items-start gap-1.5 text-xs text-red-400"
            }
            role="status"
          >
            {feedback.ok ? (
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {feedback.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
