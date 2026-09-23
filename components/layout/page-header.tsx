import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PageHeader (PR010.1) — the top of every page.
 *
 * Adds an optional breadcrumb trail, an eyebrow label and a tighter type
 * hierarchy over the PR000 version. The `title` / `description` / `actions`
 * API is unchanged, so all existing pages render without edits.
 *
 * Semantics: renders the page's single `<h1>` and, when breadcrumbs are
 * supplied, a labelled `<nav>` with `aria-current="page"` on the last crumb.
 */

export interface Breadcrumb {
  label: string;
  /** Omit on the current page — it renders as static text. */
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Small uppercase label above the title (module/context). */
  eyebrow?: string;
  breadcrumbs?: readonly Breadcrumb[];
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("mb-6 lg:mb-8", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Trilha de navegação" className="mb-3">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-white/40">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  {index > 0 && (
                    <ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-white/20" />
                  )}
                  {crumb.href && !isLast ? (
                    <Link
                      href={crumb.href}
                      className="rounded transition-colors hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={isLast ? "page" : undefined} className="text-white/60">
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-300">
              {eyebrow}
            </p>
          )}

          <h1 className="text-balance text-2xl font-semibold tracking-tight text-white lg:text-[1.75rem]">
            {title}
          </h1>

          {description && (
            <p className="mt-2 max-w-3xl text-pretty text-sm leading-relaxed text-white/50">
              {description}
            </p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
