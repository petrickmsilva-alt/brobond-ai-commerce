"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck, Megaphone, Sparkles, TriangleAlert } from "lucide-react";
import { ActivityTimeline, type ActivityItem } from "@/components/ui/activity-timeline";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * NotificationsMenu (PR010.1) — header bell + dropdown feed.
 *
 * UI-ONLY. There is no notification domain in the backend yet, so the panel
 * renders whatever `items` the shell passes it and shows the EmptyState
 * otherwise. No fetching, no polling, no server action — wiring a real feed is
 * a backend concern for a later PR and will only need to fill `items`.
 */

const EASE = [...easing.standard] as [number, number, number, number];

/** Icon set exported so a future feed can map an event type to a glyph. */
export const notificationIcons = {
  campaign: Megaphone,
  ai: Sparkles,
  alert: TriangleAlert,
  delivery: CheckCheck,
} as const;

interface NotificationsMenuProps {
  items?: readonly ActivityItem[];
  /** Count shown on the badge. Defaults to `items.length`. */
  unreadCount?: number;
}

export function NotificationsMenu({ items = [], unreadCount }: NotificationsMenuProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const count = unreadCount ?? items.length;

  React.useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          count > 0 ? `Notificações: ${count} não lidas` : "Notificações: nenhuma não lida"
        }
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl text-white/55",
          "transition-colors duration-150 hover:bg-white/[0.07] hover:text-white",
          focusRingRaised,
        )}
      >
        <Bell aria-hidden className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute right-1.5 top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-brand-400 ring-2 ring-surface-900"
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notificações"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: duration.fast, ease: EASE }}
            className="glass-panel absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Notificações</h2>
              {count > 0 && (
                <span className="rounded-full bg-brand-500/14 px-2 py-0.5 text-[10px] font-semibold text-brand-200">
                  {count} nova{count === 1 ? "" : "s"}
                </span>
              )}
            </div>

            <div className="scrollbar-thin max-h-[22rem] overflow-y-auto p-4">
              <ActivityTimeline
                items={items}
                emptyMessage="Você está em dia. Eventos de campanhas, entregas e sincronizações aparecerão aqui."
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
