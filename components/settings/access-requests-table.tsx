"use client";

import * as React from "react";
import { AlertCircle, Check, Copy, Inbox, Loader2, ShieldAlert, UserCheck, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { reviewAccessRequestAction } from "@/app/dashboard/settings/access/actions";
import type { AccessRequestView } from "@/modules/auth/access-request.service";

/**
 * Access-request queue table (PR010.3 §2) — the ADMIN surface at
 * `/dashboard/settings/access`.
 *
 * Columns: Nome · Empresa · Email · Telefone · Status · ações (Aprovar /
 * Rejeitar). Approving reviews the request AND issues + delivers the
 * invitation (role MEMBER) in one server action; the resulting invite URL is
 * shown exactly once, with a copy affordance, because the raw token is never
 * persisted — once lost, the ADMIN re-approves/re-sends and the old link dies.
 *
 * RBAC §11: `canManage` only hides the buttons. `requireAdmin()` inside the
 * server action is what actually enforces ADMIN-only.
 */

export interface AccessRequestsTableProps {
  requests: AccessRequestView[];
  /** PENDING count, for the header badge. */
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

export function AccessRequestsTable({
  requests,
  pendingCount,
  canManage,
}: AccessRequestsTableProps) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [decisionBusy, setDecisionBusy] = React.useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ url: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  async function review(id: string, decision: "APPROVED" | "REJECTED") {
    setBusy(id);
    setDecisionBusy(decision);
    setError(null);
    setIssued(null);
    setCopied(false);

    const result = await reviewAccessRequestAction({ id, decision });
    setBusy(null);
    setDecisionBusy(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data) {
      setIssued({ url: result.data.inviteUrl });
    }
  }

  async function copyInviteUrl() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      {!canManage && (
        <p className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/45">
          <ShieldAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          Somente administradores podem aprovar ou recusar solicitações de acesso.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {issued && (
        <div
          role="status"
          className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.07] px-4 py-3"
        >
          <p className="flex items-center gap-2 text-xs font-medium text-emerald-300">
            <Check aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Solicitação aprovada — convite criado e enviado.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
            O link abaixo é mostrado apenas uma vez (o token não é armazenado). Compartilhe com o
            solicitante se preferir entregá-lo por outro canal.
          </p>
          <div className="mt-2.5 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-surface-900/80 px-3 py-2 text-[11px] text-white/70">
              {issued.url}
            </code>
            <Button size="sm" variant="outline" onClick={copyInviteUrl}>
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
        <>
          <p className="flex items-center gap-2 text-xs text-white/45">
            <UserCheck aria-hidden className="h-3.5 w-3.5" />
            {pendingCount > 0
              ? `${pendingCount} solicitação${pendingCount > 1 ? "ões" : ""} pendente${
                  pendingCount > 1 ? "s" : ""
                } de ${requests.length}`
              : `${requests.length} solicitações revisadas — nenhuma pendente`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const pending = request.status === "PENDING";
                const rowBusy = busy === request.id;
                return (
                  <TableRow key={request.id} data-request-id={request.id}>
                    <TableCell className="max-w-[180px] truncate font-medium text-white">
                      {request.name}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">{request.company}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{request.email}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {request.whatsapp ?? <span className="text-white/30">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[request.status]} dot>
                        {STATUS_LABEL[request.status]}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        {pending ? (
                          <div className="inline-flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={rowBusy}
                              aria-label={`Recusar solicitação de ${request.name}`}
                              onClick={() => void review(request.id, "REJECTED")}
                            >
                              {rowBusy && decisionBusy === "REJECTED" ? (
                                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <X aria-hidden className="h-3.5 w-3.5" />
                              )}
                              Rejeitar
                            </Button>
                            <Button
                              size="sm"
                              disabled={rowBusy}
                              aria-label={`Aprovar solicitação de ${request.name}`}
                              onClick={() => void review(request.id, "APPROVED")}
                            >
                              {rowBusy && decisionBusy === "APPROVED" ? (
                                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check aria-hidden className="h-3.5 w-3.5" />
                              )}
                              Aprovar
                            </Button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-white/30">Revisada</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}
    </div>
  );
}
