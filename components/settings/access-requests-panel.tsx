"use client";

import * as React from "react";
import { AlertCircle, Check, Inbox, Loader2, ShieldAlert, UserCheck, X } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reviewAccessRequestAction } from "@/app/settings/actions";
import type { AccessRequestView } from "@/modules/auth/access-request.service";

/**
 * Access-request queue (PR010.2 §5 + §11) — "ADMIN visualizar em Configurações".
 *
 * RBAC §11: only an ADMIN may approve or reject. `canManage` hides the
 * buttons; `requireAdmin()` inside the server action is what actually
 * enforces it.
 *
 * DELIBERATE TWO-STEP: approving records a decision, it does NOT create an
 * account or send anything. The ADMIN then issues an invitation from the panel
 * above. Keeping provisioning behind a second, explicit action means a stray
 * click on "Aprovar" can never hand someone access.
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

  async function review(id: string, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    setError(null);
    const result = await reviewAccessRequestAction({ id, decision });
    setBusy(null);
    if (!result.ok) setError(result.error);
  }

  return (
    <SectionCard
      title="Solicitações de acesso"
      description="Pedidos enviados pelo formulário público. Aprovar registra a decisão — o acesso só é concedido ao enviar um convite."
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
