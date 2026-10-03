import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_SHORT_NAME } from "@/lib/constants";

/**
 * Shared chrome for the public legal pages (`/termos`, `/privacidade`).
 *
 * TikTok's App Review Guidelines require these documents to actually resolve
 * (not 404), to be visibly linked from the Web/Desktop URL "without having
 * to open a menu", and to read like real policy — not a stub. This wrapper
 * keeps both pages visually consistent with the rest of the marketing site
 * while staying out of the way of the content itself.
 */
export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-premium-glow min-h-screen">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950"
          aria-label={`${APP_SHORT_NAME} — início`}
        >
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]"
          >
            <FileText className="h-5 w-5 text-white" />
          </span>
          <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
        </Link>
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft aria-hidden className="h-4 w-4" />
            Voltar
          </Button>
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-24 pt-8">
        <h1 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-white/40">Última atualização: {updatedAt}</p>

        <div className="prose-legal mt-10 space-y-8 text-sm leading-relaxed text-white/70">
          {children}
        </div>
      </main>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-base font-semibold text-white">{heading}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
