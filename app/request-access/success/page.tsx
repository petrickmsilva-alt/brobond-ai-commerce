import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { Button } from "@/components/ui/button";
import { APP_SHORT_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Solicitação enviada",
};

/**
 * `/request-access/success` — the confirmation screen (PR010.3 §1/§10).
 *
 * PR010.2 replaced the form with an inline success card. PR010.3 §1 goes
 * further: "Após sucesso: Exibir página de confirmação. Nunca retornar para
 * o formulário." An inline state still lives at `/request-access` — a refresh
 * or a back-navigation resurrects the populated form and invites a duplicate
 * submit. A dedicated route navigated to with `router.replace` removes the
 * form from the history stack entirely, so the only way back to it is a
 * deliberate new visit.
 *
 * PUBLIC BY DESIGN (`/request-access` is in `PUBLIC_PREFIXES`): the visitor
 * has no account yet, and the page holds no data — it cannot even tell
 * whether a request was actually sent (it renders the same for everyone),
 * which is also why it can never be used to probe the queue.
 */
export default function RequestAccessSuccessPage() {
  return (
    <AuthCardShell
      title="Solicitação enviada"
      description={`Sua solicitação de acesso ao ${APP_SHORT_NAME} foi registrada.`}
      footer={
        <p className="flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-white/30">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Você receberá um convite por email caso seja aprovado.
        </p>
      }
    >
      <div className="flex flex-col items-center gap-5 py-2 text-center">
        <span
          aria-hidden
          className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-300"
        >
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <p className="max-w-sm text-balance text-xs leading-relaxed text-white/45">
          Nossa equipe vai analisar seu pedido. Se ele for aprovado, enviaremos para o seu email um
          convite de uso único com um link para você definir sua senha e acessar o workspace.
        </p>
        <Link href="/login" className="w-full">
          <Button size="lg" className="w-full">
            Ir para o login
          </Button>
        </Link>
        <Link
          href="/"
          className="text-xs font-medium text-white/45 transition-colors hover:text-white"
        >
          Voltar para a home
        </Link>
      </div>
    </AuthCardShell>
  );
}
