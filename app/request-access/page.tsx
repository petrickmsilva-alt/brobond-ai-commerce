import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Sparkles } from "lucide-react";
import { RequestAccessForm } from "@/components/auth/request-access-form";
import { APP_SHORT_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Solicitar acesso",
};

/**
 * Public access-request page (PR010.2 §5).
 *
 * The honest answer to "não tenho conta". Before this route, the login screen
 * told visitors that access is provisioned by their organization and left them
 * with nowhere to go. Now there is a door — one that queues a lead for an
 * ADMIN rather than creating an account.
 *
 * Public by design (it is listed in `PUBLIC_PREFIXES`), and safe to be: the
 * form writes one inert `AccessRequest` row and grants nothing.
 */
export default function RequestAccessPage() {
  return (
    <div className="bg-app-mesh flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]"
          >
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
        </Link>

        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-white/50 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Já tenho acesso
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 pb-16 pt-4 sm:px-6">
        <div className="mb-7 text-center">
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Solicitar acesso ao {APP_SHORT_NAME}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-pretty text-sm leading-relaxed text-white/50">
            Conte um pouco sobre você e sua operação. Nossa equipe analisa cada pedido e envia o
            convite de acesso por email.
          </p>
        </div>

        <div className="glass-panel glass-edge relative overflow-hidden rounded-2xl p-6 sm:p-8">
          <RequestAccessForm />
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-center text-[11px] leading-relaxed text-white/30">
          <ShieldCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
          Seus dados são usados apenas para avaliar este pedido de acesso.
        </p>
      </main>
    </div>
  );
}
