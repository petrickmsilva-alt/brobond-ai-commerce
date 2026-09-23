"use client";

import * as React from "react";
import { AlertCircle, Check, Copy, Inbox, Loader2, ShieldAlert, UserCheck, X } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reviewAccessRequestAction } from "@/app/settings/actions";
import type { AccessRequestView } from "@/modules/auth/access-request.service";

/**
 * Access-request queue (PR010.2 §5 + §11 · PR010.3 §2) — the legacy surface
 * inside Configurações.
 *
 * RBAC §11: only an ADMIN may approve or reject. `canManage` hides the
 * buttons; `requireAdmin()` inside the server action is what actually
 * enforces it.
 *
 * PR010.3 §2 — "Ao aprovar: Criar Invitation": approving now reviews the
 * request AND issues + delivers the invitation (role MEMBER) in the same
 * action. An invitation still is not an account — the invitee must redeem
 * the single-use link and set a password — so approving alone can never hand
 * someone access. The dedicated ADMIN surface (with the full table) lives at
 * `/dashboard/settings/access`.
 */

export interface AccessRequestsPanelProps {
  requests: AccessRequestView[];
  pendingCount: number;
  canManage: boolean;
}

const STATUS_TONE = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "neutral",
} as const;

const STATUS_LABEL = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
} as const;

export function AccessRequestsPanel({
  requests,
  pendingCount,
  canManage,
}: AccessRequestsPanelProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function review(id: string, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    setError(null);
    setIssued(null);
    setCopied(false);
    const result = await reviewAccessRequestAction({ id, decision });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data?.inviteUrl) {
      setIssued(result.data.inviteUrl);
    }
  }

  async function copyIssued() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <SectionCard
      title="Solicitações de acesso"
      description="Aprovar emite e envia automaticamente um convite de uso único. Gerencie a fila completa em /dashboard/settings/access."
      icon={UserCheck}
      actions={
        pendingCount > 0 ? (
          <Badge tone="warning" dot>
            {pendingCount} pendente{pendingCount > 1 ? "s" : ""}
          </Badge>
        ) : (
          <Badge tone="neutral">Em dia</Badge>
        )
      }
    >
      {!canManage && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/45">
          <ShieldAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          Apenas administradores podem aprovar ou recusar solicitações.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {issued && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.07] px-4 py-3"
        >
          <p className="flex items-center gap-2 text-xs font-medium text-emerald-300">
            <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Aprovado — convite criado e enviado. Link (mostrado uma única vez):
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-surface-900/80 px-3 py-2 text-[11px] text-white/70">
              {issued}
            </code>
            <Button size="sm" variant="outline" onClick={copyIssued}>
              {copied ? (
                <Check aria-hidden className="h-3.5 w-3.5" />
              ) : (
                <Copy aria-hidden className="h-3.5 w-3.5" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      {requests.length === 0 ? (
        <EmptyState
          size="sm"
          icon={Inbox}
          title="Nenhuma solicitação"
          description="Pedidos enviados pelo formulário público aparecerão aqui para revisão."
        />
      ) : (
        <ul className="space-y-2">
          {requests.map((request) => (
            <li
              key={request.id}
              className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {request.name}
                    <span className="ml-2 font-normal text-white/40">{request.company}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-white/45">
                    {request.email}
                    {request.whatsapp && ` · ${request.whatsapp}`}
                  </p>
                  {request.message && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-white/50">
                      {request.message}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>

                  {canManage && request.status === "PENDING" && (
                    <>
                      <Button
                        size="sm"
                        variant="subtle"
                        onClick={() => review(request.id, "APPROVED")}
                        disabled={busy === request.id}
                        aria-label={`Aprovar solicitação de ${request.name}`}
                      >
                        {busy === request.id ? (
                          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check aria-hidden className="h-3.5 w-3.5" />
                        )}
                        Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => review(request.id, "REJECTED")}
                        disabled={busy === request.id}
                        aria-label={`Recusar solicitação de ${request.name}`}
                      >
                        <X aria-hidden className="h-3.5 w-3.5" />
                        Recusar
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
