import * as React from "react";
import { Inbox, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * EmptyState (PR010.1) — the "nothing here yet" surface.
 *
 * Three sizes so it fits a full page, a card body or a table body. The icon is
 * decorative (`aria-hidden`); the title is the accessible message, and the
 * container is a polite live region so a list that empties out after a filter
 * change is announced without stealing focus.
 */

type EmptyStateSize = "sm" | "md" | "lg";

const sizes: Record<
  EmptyStateSize,
  { wrapper: string; medallion: string; icon: string; title: string }
> = {
  sm: { wrapper: "px-6 py-8", medallion: "h-10 w-10", icon: "h-5 w-5", title: "text-sm" },
  md: { wrapper: "px-6 py-12", medallion: "h-12 w-12", icon: "h-6 w-6", title: "text-base" },
  lg: { wrapper: "px-6 py-20", medallion: "h-16 w-16", icon: "h-8 w-8", title: "text-lg" },
};

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  /** Primary/secondary CTAs. */
  action?: React.ReactNode;
  size?: EmptyStateSize;
  /** Draws a dashed border around the state (for inline/card usage). */
  bordered?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  size = "md",
  bordered = true,
  className,
}: EmptyStateProps) {
  const style = sizes[size];

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        bordered && "rounded-2xl border border-dashed border-white/10 bg-white/[0.015]",
        style.wrapper,
        className,
      )}
    >
      <div
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-brand-500/15 to-accent-500/8 text-brand-300",
          style.medallion,
        )}
      >
        <Icon className={style.icon} />
      </div>

      <h3 className={cn("mt-4 font-semibold text-white", style.title)}>{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-balance text-xs leading-relaxed text-white/50">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>
      )}
    </div>
  );
}
