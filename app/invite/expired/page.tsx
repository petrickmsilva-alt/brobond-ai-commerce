import type { Metadata } from "next";
import Link from "next/link";
import { Hourglass, ShieldCheck } from "lucide-react";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { Button } from "@/components/ui/button";
import { INVITATION_TTL_DAYS } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Convite expirado",
};

/**
 * `/invite/expired` — the terminal state for a link that lived past its
 * `expiresAt` (PR010.3 §10).
 *
 * Distinct from `/invite/invalid` on purpose: "expired" tells the invitee the
 * invitation was real and simply ran out of time — the fix is asking for a
 * re-send — while "invalid" means the link itself cannot be trusted. One
 * message cannot honestly cover both.
 *
 * PUBLIC BY DESIGN (`/invite` is in `PUBLIC_PREFIXES`).
 */
export default function InviteExpiredPage() {
  return (
    <AuthCardShell
      title="Convite expirado"
      description={`Este convite expirou — links de convite são válidos por ${INVITATION_TTL_DAYS} dias.`}
      footer={
        <p className="flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-white/30">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Reenviar um convite invalida o link anterior.
        </p>
      }
    >
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-amber-500/18 to-accent-500/10 text-amber-300"
        >
          <Hourglass className="h-7 w-7" />
        </span>
        <p className="max-w-sm text-balance text-xs leading-relaxed text-white/45">
          Peça ao administrador do workspace para reenviar o convite — o novo link volta a valer por{" "}
          {INVITATION_TTL_DAYS} dias a partir do reenvio.
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
