"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileText, PlayCircle, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import type {
  AICeoDashboardDTO,
  AIDecisionDTO,
  DecisionPriorityName,
  DecisionStatusName,
} from "@/modules/ai-ceo/dto";
import {
  generateExecutiveDecisionsAction,
  generateExecutiveReportAction,
  transitionExecutiveDecisionAction,
} from "@/app/dashboard/ceo/actions";

const PRIORITY_LABEL: Record<DecisionPriorityName, string> = {
  LOW: "Baixa",
  MEDIUM: "Média",
  HIGH: "Alta",
  CRITICAL: "Crítica",
};

const STATUS_LABEL: Record<DecisionStatusName, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  EXECUTED: "Executada",
};

function priorityTone(priority: DecisionPriorityName) {
  if (priority === "CRITICAL" || priority === "HIGH") return "warning" as const;
  if (priority === "MEDIUM") return "brand" as const;
  return "neutral" as const;
}

function statusTone(status: DecisionStatusName) {
  if (status === "APPROVED" || status === "EXECUTED") return "success" as const;
  if (status === "PENDING") return "brand" as const;
  return "neutral" as const;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    AI_CEO_DECISIONS_GENERATED: "Análise executiva gerada",
    AI_CEO_REPORT_GENERATED: "Relatório executivo gerado",
    AI_DECISION_APPROVED: "Decisão aprovada",
    AI_DECISION_REJECTED: "Decisão rejeitada",
    AI_DECISION_EXECUTED: "Execução externa confirmada",
  };
  return labels[action] ?? action;
}

function DecisionActions({
  decision,
  isAdmin,
  pending,
  onTransition,
}: {
  decision: AIDecisionDTO;
  isAdmin: boolean;
  pending: boolean;
  onTransition: (status: "APPROVED" | "REJECTED" | "EXECUTED") => void;
}) {
  if (!isAdmin) return <span className="text-xs text-white/35">Ações: somente ADMIN</span>;
  if (decision.status === "PENDING") {
    return (
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onTransition("APPROVED")} disabled={pending}>
          <Check className="h-3.5 w-3.5" /> Aprovar
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onTransition("REJECTED")}
          disabled={pending}
        >
          <X className="h-3.5 w-3.5" /> Rejeitar
        </Button>
      </div>
    );
  }
  if (decision.status === "APPROVED") {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => onTransition("EXECUTED")}
        disabled={pending}
        title="Registra somente a confirmação humana; nenhuma ação é disparada."
      >
        <PlayCircle className="h-3.5 w-3.5" /> Confirmar execução externa
      </Button>
    );
  }
  return null;
}

export function CeoDashboard({ data, role }: { data: AICeoDashboardDTO; role: string }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState("");
  const [pendingKey, setPendingKey] = useState("");
  const [isPending, startTransition] = useTransition();
  const isAdmin = role === "ADMIN";

  function run(key: string, task: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setPendingKey(key);
    setFeedback("");
    startTransition(async () => {
      const result = await task();
      setFeedback(result.ok ? success : (result.error ?? "Erro inesperado."));
      setPendingKey("");
      if (result.ok) router.refresh();
    });
  }

  function transition(decisionId: string, status: "APPROVED" | "REJECTED" | "EXECUTED") {
    run(
      `${decisionId}:${status}`,
      () => transitionExecutiveDecisionAction({ decisionId, status }),
      status === "EXECUTED"
        ? "Execução externa registrada; nenhuma ação automática foi disparada."
        : "Estado da decisão atualizado.",
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() =>
            run(
              "analysis",
              generateExecutiveDecisionsAction,
              "Análise concluída; novas decisões foram registradas como PENDING.",
            )
          }
          disabled={isPending}
        >
          <Sparkles className={`h-4 w-4 ${pendingKey === "analysis" ? "animate-pulse" : ""}`} />
          Gerar decisões
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            run("report", generateExecutiveReportAction, "Relatório diário persistido.")
          }
          disabled={isPending}
        >
          <FileText className="h-4 w-4" /> Gerar relatório diário
        </Button>
        <p className="ml-auto max-w-xl text-xs text-white/40">
          O AI CEO apenas recomenda. Aprovação e confirmação de execução são humanas; este módulo
          nunca dispara campanhas, mensagens ou alterações comerciais.
        </p>
      </div>

      {feedback && (
        <p
          role="status"
          className="rounded-lg border border-brand-500/20 bg-brand-500/10 px-4 py-3 text-sm text-brand-200"
        >
          {feedback}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top 5 decisões</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.decisions.map((decision, index) => (
              <article
                key={decision.id}
                className="rounded-xl border border-surface-700 bg-surface-900/45 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-white/35">#{index + 1}</span>
                      <Badge tone={priorityTone(decision.priority)}>
                        {PRIORITY_LABEL[decision.priority]}
                      </Badge>
                      <Badge tone={statusTone(decision.status)}>
                        {STATUS_LABEL[decision.status]}
                      </Badge>
                      <Badge>{decision.category}</Badge>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-white">{decision.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-white/65">{decision.description}</p>
                    <p className="mt-2 text-xs leading-5 text-white/45">
                      <strong className="text-white/60">Motivo:</strong> {decision.reason}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-300">
                      {formatCurrency(decision.potentialRevenueCents)}
                    </div>
                    <div className="text-[11px] text-white/35">receita potencial</div>
                    <div className="mt-2 text-xs text-white/45">
                      {Math.round(decision.confidence * 100)}% confiança
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-surface-800 pt-3">
                  <div className="mb-3 flex flex-wrap gap-2">
                    {decision.evidence.map((evidence) => (
                      <span
                        key={evidence.id}
                        title={evidence.sourceId}
                        className="rounded-md bg-surface-800 px-2 py-1 text-[11px] text-white/50"
                      >
                        {evidence.sourceType} · {Math.round(evidence.weight * 100)}%
                      </span>
                    ))}
                  </div>
                  <DecisionActions
                    decision={decision}
                    isAdmin={isAdmin}
                    pending={isPending && pendingKey.startsWith(decision.id)}
                    onTransition={(status) => transition(decision.id, status)}
                  />
                </div>
              </article>
            ))}
            {data.decisions.length === 0 && (
              <div className="py-12 text-center text-sm text-white/40">
                Nenhuma decisão registrada. Gere a primeira análise executiva.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline auditável</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4 border-l border-surface-700 pl-4">
              {data.timeline.map((item) => (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-surface-950 bg-brand-400" />
                  <div className="text-sm text-white/70">{actionLabel(item.action)}</div>
                  <div className="mt-1 text-xs text-white/35">
                    {new Date(item.createdAt).toLocaleString("pt-BR")}
                  </div>
                </li>
              ))}
              {data.timeline.length === 0 && (
                <li className="text-sm text-white/35">Sem eventos do AI CEO.</li>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>

      <ExecutiveReportCard report={data.latestReport} />
    </div>
  );
}

function ExecutiveReportCard({ report }: { report: AICeoDashboardDTO["latestReport"] }) {
  if (!report) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 py-8 text-sm text-white/40">
          <FileText className="h-5 w-5" /> Nenhum relatório executivo diário gerado.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>
          Relatório executivo · {new Date(report.reportDate).toLocaleDateString("pt-BR")}
        </CardTitle>
        <Badge>{report.promptVersion}</Badge>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-white/70">{report.summary}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <ReportMetric label="GMV" value={formatCurrency(report.gmvCents)} />
          <ReportMetric label="ROI" value={`${(report.roiBps / 100).toFixed(1)}%`} />
          <ReportMetric label="Creators" value={String(report.creators)} />
          <ReportMetric label="Produtos" value={String(report.products)} />
          <ReportMetric label="Campanhas" value={String(report.campaigns)} />
        </div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <ReportList
            title="Riscos"
            icon={<AlertTriangle className="h-4 w-4 text-amber-300" />}
            items={report.risks}
          />
          <ReportList
            title="Oportunidades"
            icon={<Sparkles className="h-4 w-4 text-brand-300" />}
            items={report.opportunities}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-800/70 p-3">
      <div className="text-xs text-white/35">{label}</div>
      <div className="mt-1 font-semibold text-white">{value}</div>
    </div>
  );
}

function ReportList({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
}) {
  return (
    <div className="rounded-lg border border-surface-700 p-4">
      <h4 className="flex items-center gap-2 text-sm font-medium text-white">
        {icon} {title}
      </h4>
      <ul className="mt-3 space-y-2 text-sm text-white/55">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
        {items.length === 0 && <li>Nenhum item apontado.</li>}
      </ul>
    </div>
  );
}
