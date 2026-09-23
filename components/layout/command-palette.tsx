"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Search } from "lucide-react";
import { navigationGroups, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * CommandPalette (PR010.1) — global Ctrl/⌘+K navigation search.
 *
 * Client-side only: it searches the static navigation manifest
 * (`lib/navigation.ts`) and pushes a route. It performs no data fetching, no
 * server action and no privileged lookup, so it can never leak a record the
 * viewer is not entitled to — every destination re-checks RBAC and tenancy
 * server-side on navigation.
 *
 * Keyboard model (WAI-ARIA combobox + listbox):
 *   ⌘K / Ctrl+K  open        ↑ ↓  move        ⏎  go        Esc  close
 */

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Entry extends NavItem {
  group: string;
}

const EASE = [...easing.standard] as [number, number, number, number];

const ALL_ENTRIES: Entry[] = navigationGroups.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.label })),
);

/** Accent-insensitive, case-insensitive normalisation for pt-BR matching. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const returnFocusRef = React.useRef<HTMLElement | null>(null);
  const listId = React.useId();

  const results = React.useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return ALL_ENTRIES;
    return ALL_ENTRIES.filter((entry) =>
      [entry.label, entry.group, entry.description ?? ""].some((field) =>
        normalize(field).includes(term),
      ),
    );
  }, [query]);

  // Reset transient state on every open, move focus into the modal and restore
  // it to the invoking control after close (WAI-ARIA dialog focus contract).
  React.useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveIndex(0);

    // Focus after the enter animation's first frame.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(id);
      returnFocusRef.current?.focus();
      returnFocusRef.current = null;
    };
  }, [open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep keyboard selection visible in a long result set without moving DOM
  // focus away from the combobox.
  React.useEffect(() => {
    if (!open || !results[activeIndex]) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listId, open, results]);

  // Lock background scroll while the modal is open.
  React.useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // The combobox owns virtual focus through aria-activedescendant. Keeping
    // physical focus there also traps keyboard navigation inside this modal.
    if (event.key === "Tab") {
      event.preventDefault();
      inputRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        results.length === 0 ? 0 : (index - 1 + results.length) % results.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const target = results[activeIndex];
      if (target) go(target.href);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
          onKeyDown={onKeyDown}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.fast }}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Busca global"
            initial={{ opacity: 0, y: -8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={{ duration: duration.normal, ease: EASE }}
            className="glass-panel relative w-full max-w-xl overflow-hidden rounded-2xl"
          >
            <div className="flex items-center gap-3 border-b border-white/8 px-4">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-white/40" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-label="Buscar módulos, páginas e ações"
                aria-expanded={true}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  results[activeIndex] ? `${listId}-${activeIndex}` : undefined
                }
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar módulos, páginas e ações…"
                className="h-14 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
              />
              <kbd className="hidden shrink-0 rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-white/40 sm:block">
                Esc
              </kbd>
            </div>

            <ul
              id={listId}
              role="listbox"
              aria-label="Resultados"
              className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2"
            >
              {results.length === 0 && (
                <li className="px-3 py-8 text-center text-sm text-white/45">
                  Nenhum resultado para “{query}”.
                </li>
              )}

              {results.map((entry, index) => {
                const Icon = entry.icon;
                const active = index === activeIndex;
                return (
                  <li
                    key={entry.href}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={active}
                  >
                    <button
                      type="button"
                      tabIndex={-1}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(entry.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-100",
                        active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]",
                      )}
                    >
                      <span
                        aria-hidden
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/8 bg-white/[0.04] text-brand-300"
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">
                          {entry.label}
                        </span>
                        {entry.description && (
                          <span className="block truncate text-xs text-white/45">
                            {entry.description}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/30">
                        {entry.group}
                      </span>
                      {active && (
                        <CornerDownLeft
                          aria-hidden
                          className="h-3.5 w-3.5 shrink-0 text-white/35"
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2.5 text-[10px] text-white/35">
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-white/12 px-1 py-0.5">↑</kbd>
                <kbd className="rounded border border-white/12 px-1 py-0.5">↓</kbd>
                navegar
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="rounded border border-white/12 px-1 py-0.5">⏎</kbd>
                abrir
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
