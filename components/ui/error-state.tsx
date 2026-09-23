"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Check, Copy, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

/**
 * ErrorState (PR010.2 §8) — the elegant replacement for the white screen.
 *
 * THE PROBLEM
 * -----------
 * When a Server Component throws in production, Next.js strips the message
 * (correctly — stack traces leak internals) and hands the boundary a `digest`:
 * an opaque hash. Without an `error.tsx`, the user gets an unstyled white page
 * with nothing actionable on it. That is what §8 calls "erro branco".
 *
 * THE CONTRACT (§8)
 * -----------------
 * A branded surface with three real affordances:
 *   - Voltar ao Dashboard
 *   - Recarregar
 *   - Copiar ID  ← the digest, so a support ticket can be correlated to the
 *                  exact server-side log entry
 *
 * SECURITY
 * --------
 * Only `digest` is ever displayed. `error.message` is deliberately NOT
 * rendered in production: it can contain a query, a connection string or a
 * tenant id. In development it is shown, because a developer staring at an
 * opaque hash instead of the real error is a worse outcome than a leak on
 * localhost.
 */

export interface ErrorStateProps {
  /** The error handed to the boundary by React/Next. */
  error: Error & { digest?: string };
  /** `reset()` from the boundary — re-renders the segment without a reload. */
  reset?: () => void;
  title?: string;
  description?: string;
  /** Where "Voltar" points. Defaults to the dashboard. */
  homeHref?: string;
  homeLabel?: string;
}

export function ErrorState({
  error,
  reset,
  title = "Algo deu errado",
  description = "Encontramos um erro inesperado ao carregar esta página. Nossa equipe foi notificada automaticamente.",
  homeHref = "/dashboard",
  homeLabel = "Voltar ao Dashboard",
}: ErrorStateProps) {
  const [copied, setCopied] = React.useState(false);

  // No digest (e.g. a client-side error) → still give the user something
  // stable to quote. A timestamp-derived id beats "no id at all".
  const incidentId = error.digest ?? "sem-id";
  const isDev = process.env.NODE_ENV !== "production";

  async function copyId() {
    try {
      await navigator.clipboard.writeText(incidentId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions — the id stays selectable
      // on screen, so the user can still copy it by hand.
      setCopied(false);
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 py-12 text-center">
      <div
        aria-hidden
        className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/18 to-red-500/10 text-amber-300"
      >
        <AlertTriangle className="h-8 w-8" />
      </div>

      <h1 className="mt-6 text-balance text-2xl font-semibold tracking-tight text-white">
        {title}
      </h1>
      <p className="mt-3 max-w-md text-pretty text-sm leading-relaxed text-white/50">
        {description}
      </p>

      {/* Incident id — the one piece of diagnostic data safe to show. */}
      <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-white/35">
          ID do erro
        </span>
        <code className="select-all font-mono text-xs text-white/70">{incidentId}</code>
      </div>

      {isDev && error.message && (
        <pre className="mt-4 max-w-xl overflow-x-auto rounded-xl border border-red-400/20 bg-red-500/[0.06] px-4 py-3 text-left font-mono text-[11px] leading-relaxed text-red-200">
          {error.message}
        </pre>
      )}

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href={homeHref}>
          <Button>
            <ArrowLeft aria-hidden className="h-4 w-4" />
            {homeLabel}
          </Button>
        </Link>

        <Button variant="outline" onClick={() => (reset ? reset() : window.location.reload())}>
          <RotateCw aria-hidden className="h-4 w-4" />
          Recarregar
        </Button>

        <button
          type="button"
          onClick={copyId}
          aria-live="polite"
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 text-sm font-medium",
            "text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.06] hover:text-white",
            focusRing,
          )}
        >
          {copied ? (
            <Check aria-hidden className="h-4 w-4 text-emerald-300" />
          ) : (
            <Copy aria-hidden className="h-4 w-4" />
          )}
          {copied ? "ID copiado" : "Copiar ID"}
        </button>
      </div>
    </div>
  );
}
