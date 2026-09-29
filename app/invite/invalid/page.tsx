import type { Metadata } from "next";
import Link from "next/link";
import { MailX, ShieldCheck } from "lucide-react";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Convite inválido",
};

/**
 * `/invite/invalid` — the terminal state for a link that cannot be redeemed
 * (PR010.3 §10).
 *
 * `/invite/[token]` redirects here when the token is unknown, already used or
 * revoked. A dedicated page (instead of an inline error) gives the state a
 * stable URL, its own explanation, and somewhere for the invitee to go next —
 * the same three things every other dead-end in the auth flow already had.
 *
 * PUBLIC BY DESIGN (`/invite` is in `PUBLIC_PREFIXES`): the invitee has no
 * session yet, and this page grants nothing — it only explains.
 */
export default function InviteInvalidPage() {
  return (
    <AuthCardShell
      title="Convite inválido"
      description="Este link de convite não existe, já foi utilizado ou foi revogado."
      footer={
        <p className="flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-white/30">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Convites são de uso único e enviados apenas por email.
        </p>
      }
    >
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-brand-500/18 to-accent-500/10 text-brand-300"
        >
          <MailX className="h-7 w-7" />
        </span>
        <p className="max-w-sm text-balance text-xs leading-relaxed text-white/45">
          Peça ao administrador do workspace para enviar um novo convite, ou solicite acesso se você
          ainda não tem uma conta.
        </p>
        <Link href="/login" className="w-full">
          <Button size="lg" className="w-full">
            Ir para o login
          </Button>
        </Link>
        {/* PR010.4 §1/§2 — "Solicitar acesso" is gone. Someone holding a
            dead invite link is not stuck any more: they can create their own
            workspace right now instead of waiting on an administrator. */}
        <Link
          href="/signup"
          className="text-xs font-medium text-white/45 transition-colors hover:text-white"
        >
          Criar minha própria conta
        </Link>
      </div>
    </AuthCardShell>
  );
}
