"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronsUpDown, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * WorkspaceSwitcher (PR010.1) — tenant selector in the sidebar brand slot.
 *
 * UI-ONLY. Tenancy is resolved server-side from the session
 * (`lib/session.ts#requireOrganization`) and no client control may ever change
 * it — switching a workspace is a server concern. This component therefore
 * only *presents* the active workspace; the list is informational and the
 * single available entry is rendered as the current selection.
 *
 * Accessibility: a real disclosure button (`aria-expanded` / `aria-haspopup`),
 * a listbox with `aria-selected`, Escape to dismiss and a click-outside guard.
 */

export interface WorkspaceOption {
  id: string;
  name: string;
  /** Plan / role caption shown under the name. */
  caption?: string;
}

interface WorkspaceSwitcherProps {
  workspace: WorkspaceOption;
  /** Additional workspaces, presented read-only. */
  options?: readonly WorkspaceOption[];
  collapsed?: boolean;
}

const EASE = [...easing.standard] as [number, number, number, number];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export function WorkspaceSwitcher({ workspace, options, collapsed }: WorkspaceSwitcherProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const all = React.useMemo(
    () => (options && options.length > 0 ? options : [workspace]),
    [options, workspace],
  );

  React.useEffect(() => {
    if (!open) return;

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

  if (collapsed) {
    return (
      <div
        className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-10px_rgba(79,70,229,0.9)]"
        title={workspace.name}
      >
        <Sparkles aria-hidden className="h-5 w-5 text-white" />
        <span className="sr-only">Workspace ativo: {workspace.name}</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] p-2 text-left",
          "transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.06]",
          focusRingRaised,
        )}
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-600 text-[11px] font-bold text-white"
        >
          {initials(workspace.name)}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs font-semibold text-white">{workspace.name}</span>
          {workspace.caption && (
            <span className="block truncate text-[10px] uppercase tracking-wider text-white/40">
              {workspace.caption}
            </span>
          )}
        </span>
        <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/35" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: duration.fast, ease: EASE }}
            className="glass-panel absolute left-0 right-0 top-full z-50 mt-2 rounded-xl p-1.5"
          >
            <ul role="listbox" aria-label="Workspaces">
              {all.map((option) => {
                const active = option.id === workspace.id;
                return (
                  <li key={option.id} role="option" aria-selected={active}>
                    <div
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2 py-2 text-xs",
                        active ? "bg-brand-500/12 text-white" : "text-white/60",
                      )}
                    >
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-[10px] font-bold text-white/70"
                      >
                        {initials(option.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
                      {active && <Check aria-hidden className="h-3.5 w-3.5 text-brand-300" />}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="border-t border-white/8 px-2 pb-1 pt-2 text-[10px] leading-relaxed text-white/35">
              O workspace é resolvido pela sessão no servidor.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
