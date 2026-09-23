import Link from "next/link";
import { Sparkles } from "lucide-react";
import { APP_SHORT_NAME } from "@/lib/constants";
import { FadeIn } from "@/components/ui/motion";

/**
 * Shared centred glass shell for the secondary auth screens (PR010.2).
 *
 * `/forgot-password`, `/reset-password` and `/invite/[token]` are all "one
 * card, one task" pages. Sharing this shell keeps their brand lockup, spacing,
 * radius (16px) and glass treatment identical, so the flow feels like one
 * product rather than three pages built at three different times.
 *
 * A Server Component — it holds no state and takes no session.
 */
export interface AuthCardShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Rendered under the card (secondary links, fine print). */
  footer?: React.ReactNode;
}

export function AuthCardShell({ title, description, children, footer }: AuthCardShellProps) {
  return (
    <div className="bg-app-mesh flex min-h-screen flex-col">
      <header className="mx-auto w-full max-w-5xl px-6 py-5">
        <Link
          href="/"
          className="flex w-fit items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-950"
        >
          <span
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]"
          >
            <Sparkles className="h-5 w-5 text-white" />
          </span>
          <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-20 sm:px-6">
        {/* §13 — one shared entrance for every secondary auth screen, so
            /forgot-password, /reset-password and /invite feel like one flow.
            FadeIn is inert under `prefers-reduced-motion`. */}
        <FadeIn className="glass-panel glass-edge relative overflow-hidden rounded-2xl p-7 sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
            {description && (
              <p className="mt-1.5 text-pretty text-sm leading-relaxed text-white/50">
                {description}
              </p>
            )}
          </div>

          {children}
        </FadeIn>

        {footer && <div className="mt-6">{footer}</div>}
      </main>
    </div>
  );
}
