import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 404 — restyled to the PR010.1 design system (glass medallion + mesh). */
export default function NotFound() {
  return (
    <main className="bg-premium-glow flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div
        aria-hidden
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-brand-500/18 to-accent-500/10 text-brand-300"
      >
        <Compass className="h-8 w-8" />
      </div>

      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-300">
        Erro 404
      </p>
      <h1 className="mt-2 text-balance text-3xl font-semibold tracking-tight text-white">
        Página não encontrada
      </h1>
      <p className="mt-3 max-w-sm text-pretty text-sm leading-relaxed text-white/50">
        A página que você procura não existe, foi movida ou você não tem acesso a ela.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/dashboard">
          <Button>
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Voltar ao Dashboard
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline">Ir para a home</Button>
        </Link>
      </div>
    </main>
  );
}
