"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Loader2,
  Mail,
  ShieldAlert,
  UserPlus,
  X,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createInvitationAction, revokeInvitationAction } from "@/app/settings/actions";
import type { InvitationView } from "@/modules/auth/invitation.service";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

/**
 * Invitation management panel (PR010.2 §7 + §11).
 *
 * RBAC §11 — ADMIN gerencia convites; MANAGER e MEMBER não.
 * The `canManage` prop only controls affordances: it hides the form and the
 * revoke buttons. The authority is `requireAdmin()` inside the server actions,
 * which a non-ADMIN cannot get around by replaying a request.
 *
 * THE INVITE URL IS SHOWN ONCE. The raw token is never persisted (only its
 * SHA-256 digest is), so it cannot be re-read later. The panel makes that
 * explicit and offers a copy button, because a link the ADMIN loses means
 * re-sending the invite.
 */

export interface InvitationsPanelProps {
  invitations: InvitationView[];
  canManage: boolean;
}

const STATUS_TONE = {
  PENDING: "warning",
  ACCEPTED: "success",
  REVOKED: "neutral",
  EXPIRED: "danger",
} as const;

const STATUS_LABEL = {
  PENDING: "Pendente",
  ACCEPTED: "Aceito",
  REVOKED: "Revogado",
  EXPIRED: "Expirado",
} as const;

export function InvitationsPanel({ invitations, canManage }: InvitationsPanelProps) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<"MANAGER" | "MEMBER">("MEMBER");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [revoking, setRevoking] = React.useState<string | null>(null);

  async function onInvite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setIssued(null);

    const result = await createInvitationAction({ email, name, role });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data) {
      setIssued({ url: result.data.inviteUrl, email: result.data.email });
    }
    setEmail("");
    setName("");
  }

  async function onRevoke(id: string) {
    setRevoking(id);
    setError(null);
    const result = await revokeInvitationAction({ id });
    setRevoking(null);
    if (!result.ok) setError(result.error);
  }

  async function copyUrl() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <SectionCard
      title="Convites"
      description="Convide pessoas para este workspace. O convite expira automaticamente e só pode ser usado uma vez."
      icon={UserPlus}
      actions={canManage ? undefined : <Badge tone="neutral">Somente ADMIN</Badge>}
    >
      {canManage ? (
        <form onSubmit={onInvite} className="grid gap-3 sm:grid-cols-[1.4fr_1fr_auto]">
          <div className="space-y-1.5">
            <label htmlFor="invite-email" className="text-xs font-medium text-white/60">
              Email
            </label>
            <Input
              id="invite-email"
              type="email"
              required
              placeholder="pessoa@empresa.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="invite-role" className="text-xs font-medium text-white/60">
              Papel
            </label>
            <Select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as "MANAGER" | "MEMBER")}
            >
              <option value="MEMBER">MEMBER — leitura</option>
              <option value="MANAGER">MANAGER — operação</option>
            </Select>
          </div>

          <div className="flex items-end">
            <Button type="submit" disabled={pending || !email} className="w-full sm:w-auto">
              {pending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}
              {pending ? "Enviando…" : "Convidar"}
            </Button>
          </div>

          <div className="space-y-1.5 sm:col-span-3">
            <label htmlFor="invite-name" className="text-xs font-medium text-white/60">
              Nome <span className="text-white/30">(opcional)</span>
            </label>
            <Input
              id="invite-name"
              placeholder="Ana Ribeiro"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
        </form>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-white/45">
          <ShieldAlert aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          Apenas administradores podem gerenciar convites. Você pode visualizar o histórico abaixo.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-red-300"
        >
          <AlertCircle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {/* The link is visible exactly once — say so plainly. */}
      {issued && (
        <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.07] p-4">
          <p className="text-xs font-semibold text-emerald-300">
            Convite criado para {issued.email}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/50">
            Copie o link agora — por segurança, ele não pode ser exibido novamente. Reenviar o
            convite gera um novo link e invalida este.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/8 bg-surface-900/80 px-3 py-2 font-mono text-[11px] text-white/70">
              {issued.url}
            </code>
            <button
              type="button"
              onClick={copyUrl}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/80",
                "transition-colors hover:bg-white/[0.08]",
                focusRing,
              )}
            >
              {copied ? (
                <Check aria-hidden className="h-3.5 w-3.5 text-emerald-300" />
              ) : (
                <Copy aria-hidden className="h-3.5 w-3.5" />
              )}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>
        </div>
      )}

      {/* §10 — empty state with a CTA rather than a dead end. */}
      <div className="mt-6">
        {invitations.length === 0 ? (
          <EmptyState
            size="sm"
            icon={Mail}
            title="Nenhum convite enviado"
            description={
              canManage
                ? "Convide sua equipe para colaborar neste workspace."
                : "Nenhum convite foi enviado neste workspace até agora."
            }
          />
        ) : (
          <ul className="space-y-2">
            {invitations.map((invitation) => {
              const status = invitation.expired ? "EXPIRED" : invitation.status;
              return (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">{invitation.email}</p>
                    <p className="mt-0.5 text-[11px] text-white/40">
                      {invitation.role} · expira em{" "}
                      {invitation.expiresAt.toLocaleDateString("pt-BR")}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
                    {canManage && invitation.status === "PENDING" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRevoke(invitation.id)}
                        disabled={revoking === invitation.id}
                        aria-label={`Revogar convite de ${invitation.email}`}
                      >
                        {revoking === invitation.id ? (
                          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <X aria-hidden className="h-3.5 w-3.5" />
                        )}
                        Revogar
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
