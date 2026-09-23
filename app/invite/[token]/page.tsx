import type { Metadata } from "next";
import Link from "next/link";
import { Building2, MailX, ShieldCheck } from "lucide-react";
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InvitationError, invitationService } from "@/modules/auth/invitation.service";
import type { InvitationPreview } from "@/modules/auth/invitation.service";

export const metadata: Metadata = {
  title: "Ativar convite",
};

/**
 * Invitation landing page — `/invite/[token]` (PR010.2 §7).
 *
 * FLOW: validar convite → definir senha → entrar automaticamente.
 *
 * The token is validated on the SERVER before anything renders, so a dead
 * link produces an explanation instead of a form that fails on submit. The
 * preview shows the invitee which workspace and which role they are joining
 * — a small anti-phishing affordance, and the reason `preview()` exists
 * separately from `accept()`.
 *
 * PUBLIC BY NECESSITY: an invitee has no session yet, so `/invite` is in
 * `PUBLIC_PREFIXES`. The token itself is the credential — 256 bits of
 * entropy, single-use, expiring — and it is the only thing that grants
 * anything here.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = decodeURIComponent(rawToken ?? "").trim();

  let preview: InvitationPreview | null = null;
  let rejection: string | null = null;

  try {
    preview = await invitationService.preview(token);
  } catch (error) {
    rejection =
      error instanceof InvitationError ? error.message : "Não foi possível validar este convite.";
    if (!(error instanceof InvitationError)) {
      console.error("[invite.preview]", error);
    }
  }

  if (!preview) {
    return (
      <AuthCardShell
        title="Convite indisponível"
        description={rejection ?? "Este convite não é mais válido."}
      >
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-brand-500/18 to-accent-500/10 text-brand-300"
          >
            <MailX className="h-7 w-7" />
          </span>
          <p className="max-w-sm text-balance text-xs leading-relaxed text-white/45">
            Peça ao administrador do workspace para enviar um novo convite, ou entre em contato se
            você já tiver uma conta.
          </p>
          <Link href="/login" className="w-full">
            <Button size="lg" className="w-full">
              Ir para o login
            </Button>
          </Link>
          <Link
            href="/request-access"
            className="text-xs font-medium text-white/45 transition-colors hover:text-white"
          >
            Solicitar acesso
          </Link>
        </div>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell
      title="Você foi convidado"
      description="Defina sua senha para ativar seu acesso. Você entrará automaticamente ao concluir."
      footer={
        <p className="flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-white/30">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Este convite é de uso único e expira automaticamente.
        </p>
      }
    >
      {/* Which workspace, which role — shown before any password is typed. */}
      <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-brand-500/12 text-brand-300"
          >
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{preview.organizationName}</p>
            <p className="text-[11px] text-white/40">Workspace</p>
          </div>
        </div>
        <Badge tone="brand">{preview.role}</Badge>
      </div>

      <AcceptInvitationForm token={token} email={preview.email} defaultName={preview.name} />
    </AuthCardShell>
  );
}
