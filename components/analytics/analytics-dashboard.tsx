"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { refreshAnalyticsAction } from "@/app/dashboard/analytics/actions";

export interface AttributionRowDto {
  key: string;
  label: string;
  revenueCents: number;
  salesCount: number;
  unitsSold: number;
  shareBps: number;
}

interface Props {
  days: number;
  computedAt: string;
  stale: boolean;
  attribution: {
    byProduct: AttributionRowDto[];
    byCreator: AttributionRowDto[];
    byCampaign: AttributionRowDto[];
  };
}

const PERIODS = [7, 30, 90] as const;

function sharePercent(bps: number) {
  return (bps / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function AttributionTable({ title, rows }: { title: string; rows: AttributionRowDto[] }) {
  const visible = rows.slice(0, 10);
  return (
    <div className="rounded-xl border border-surface-700">
      <h3 className="border-b border-surface-700 bg-surface-900/50 px-4 py-3 text-sm font-semibold text-white">
        {title}
      </h3>
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-surface-800">
          {visible.map((row) => (
            <tr key={row.key}>
              <td className="px-4 py-3 text-white">
                <div>{row.label}</div>
                <div className="mt-1 h-1 w-full max-w-[220px] rounded-full bg-surface-800">
                  <div
                    className="h-1 rounded-full bg-brand-500"
                    style={{ width: `${Math.min(100, row.shareBps / 100)}%` }}
                  />
                </div>
              </td>
              <td className="px-4 py-3 text-right text-white/80">
                {formatCurrency(row.revenueCents)}
              </td>
              <td className="px-4 py-3 text-right text-white/60">{row.salesCount}</td>
              <td className="px-4 py-3 text-right text-white/60">{row.unitsSold}</td>
              <td className="px-4 py-3 text-right text-brand-200">{sharePercent(row.shareBps)}%</td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-white/40">
                Sem dados no período.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {visible.length > 0 && (
        <p className="border-t border-surface-800 px-4 py-2 text-xs text-white/35">
          Top {visible.length} por receita (PAID) · % = participação na receita do período
        </p>
      )}
    </div>
  );
}

/**
 * PR008 — Analytics & Attribution dashboard body: period selector,
 * refresh action and the three attribution tables (CSS-only share bars —
 * no chart dependency).
 */
export function AnalyticsDashboard(props: Props) {
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();

  function refresh() {
    setFeedback("");
    startTransition(async () => {
      const result = await refreshAnalyticsAction({ days: props.days });
      setFeedback(
        result.ok ? "Snapshot recalculado com sucesso." : (result.error ?? "Erro inesperado."),
      );
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase text-white/40">Período</span>
        {PERIODS.map((period) => (
          <a
            key={period}
            href={`/dashboard/analytics?days=${period}`}
            className={
              period === props.days
                ? "rounded-lg bg-brand-600/20 px-3 py-1.5 text-sm text-brand-200"
                : "rounded-lg border border-surface-700 px-3 py-1.5 text-sm text-white/60 hover:text-white"
            }
          >
            {period}d
          </a>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-white/40">
            Computado em {new Date(props.computedAt).toLocaleString("pt-BR")}
            {props.stale && " · dados novos disponíveis"}
          </span>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={pending}>
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
            Recalcular
          </Button>
        </div>
      </div>

      {props.stale && (
        <p role="status" className="text-sm text-amber-300/90">
          Há vendas mais recentes do que este snapshot — clique em Recalcular para atualizar os
          números.
        </p>
      )}

      {feedback && (
        <p role="status" className="text-sm text-brand-200">
          {feedback}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <AttributionTable title="Atribuição por produto" rows={props.attribution.byProduct} />
        <AttributionTable title="Atribuição por creator" rows={props.attribution.byCreator} />
        <AttributionTable title="Atribuição por campanha" rows={props.attribution.byCampaign} />
      </div>
    </div>
  );
}
