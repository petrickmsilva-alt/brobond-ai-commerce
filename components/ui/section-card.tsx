import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SectionCard (PR010.1) — titled content container.
 *
 * The workhorse wrapper for tables, forms and lists: a header row (icon,
 * title, description, trailing actions) above a body slot. Renders a real
 * `<section>` with an `aria-labelledby` link to its heading so screen-reader
 * users can navigate the page by landmark.
 */

export interface SectionCardProps extends React.HTMLAttributes<HTMLElement> {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Trailing controls rendered in the header (buttons, filters, tabs). */
  actions?: React.ReactNode;
  /** Removes the body padding — use for edge-to-edge tables. */
  flush?: boolean;
  variant?: "default" | "glass";
}

export function SectionCard({
  title,
  description,
  icon: Icon,
  actions,
  flush,
  variant = "default",
  className,
  children,
  ...props
}: SectionCardProps) {
  const headingId = React.useId();

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "glass-edge relative overflow-hidden rounded-2xl border",
        variant === "glass"
          ? "border-white/10 bg-surface-850/70 backdrop-blur-xl shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]"
          : "border-white/8 bg-surface-850 bg-gradient-to-b from-white/[0.045] to-transparent shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]",
        className,
      )}
      {...props}
    >
      <header className="flex flex-col gap-3 px-6 pt-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && (
            <div
              aria-hidden
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.04] text-brand-300"
            >
              <Icon className="h-4.5 w-4.5" />
            </div>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="truncate text-sm font-semibold tracking-tight text-white">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-relaxed text-white/50">{description}</p>
            )}
          </div>
        </div>

        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>

      <div className={cn(flush ? "mt-5" : "p-6 pt-5")}>{children}</div>
    </section>
  );
}
