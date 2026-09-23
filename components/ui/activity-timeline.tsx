import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * ActivityTimeline (PR010.1) — vertical event feed.
 *
 * Semantics: an ordered list (`<ol>`), because the feed is chronological and
 * order carries meaning. The connector rail and the node medallions are
 * decorative; every item's meaning lives in its text, and timestamps use
 * `<time dateTime>` so assistive tech reads a machine-precise value.
 */

export type ActivityTone = "brand" | "success" | "warning" | "danger" | "neutral";

const toneStyles: Record<ActivityTone, string> = {
  brand: "border-brand-400/30 bg-brand-500/15 text-brand-300",
  success: "border-emerald-400/30 bg-emerald-500/15 text-emerald-300",
  warning: "border-amber-400/30 bg-amber-500/15 text-amber-300",
  danger: "border-red-400/30 bg-red-500/15 text-red-300",
  neutral: "border-white/10 bg-white/[0.06] text-white/55",
};

export interface ActivityItem {
  id: string;
  title: string;
  description?: string;
  /** Human-readable time ("há 2 horas", "12 mar 14:30"). */
  timestamp: string;
  /** Machine-readable ISO timestamp for `<time dateTime>`. */
  isoTimestamp?: string;
  icon?: LucideIcon;
  tone?: ActivityTone;
  /** Optional trailing element (badge, amount, link). */
  meta?: React.ReactNode;
}

export interface ActivityTimelineProps {
  items: readonly ActivityItem[];
  /** Message shown when the feed is empty. */
  emptyMessage?: string;
  className?: string;
}

export function ActivityTimeline({
  items,
  emptyMessage = "Nenhuma atividade registrada ainda.",
  className,
}: ActivityTimelineProps) {
  if (items.length === 0) {
    return <EmptyState size="sm" title="Sem atividade" description={emptyMessage} bordered />;
  }

  return (
    <ol className={cn("relative space-y-1", className)}>
      {items.map((item, index) => {
        const Icon = item.icon ?? Circle;
        const isLast = index === items.length - 1;

        return (
          <li key={item.id} className="relative flex gap-3.5 pb-4 last:pb-0">
            {/* Connector rail */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 bottom-0 w-px bg-gradient-to-b from-white/12 to-white/[0.03]"
              />
            )}

            <span
              aria-hidden
              className={cn(
                "relative z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                toneStyles[item.tone ?? "neutral"],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium leading-snug text-white/90">{item.title}</p>
                {item.meta && <div className="shrink-0">{item.meta}</div>}
              </div>

              {item.description && (
                <p className="mt-1 text-xs leading-relaxed text-white/50">{item.description}</p>
              )}

              <time
                dateTime={item.isoTimestamp}
                className="mt-1.5 block text-[11px] font-medium text-white/35"
              >
                {item.timestamp}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
