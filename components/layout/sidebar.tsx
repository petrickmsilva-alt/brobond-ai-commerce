"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, PanelLeft, PanelLeftClose, X } from "lucide-react";
import {
  navigationGroups,
  settingsNavItem,
  isNavItemActive,
  isNavItemSelected,
  findActiveGroup,
} from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * Sidebar (PR010.1) — grouped, collapsible enterprise navigation rail.
 *
 * - Six module groups (Overview · Commerce · Creators · Campaigns ·
 *   Integrations · System), each independently expandable with an animated
 *   height transition.
 * - Icon-only collapsed mode (76px) with accessible tooltips.
 * - Official Brobond Wear monogram and wordmark in the brand slot.
 * - Per-item badges (e.g. "IA", counts).
 *
 * Off-canvas on mobile (`role="dialog"` + focus trap boundaries via the
 * overlay), fixed rail from `lg` upwards.
 */

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface BrandLockupProps {
  collapsed: boolean;
}

/** Coupled double-B monogram and robust BROBOND WEAR wordmark. */
function BrandLockup({ collapsed }: BrandLockupProps) {
  return (
    <Link
      href="/dashboard"
      aria-label="Brobond Wear — ir para o início"
      className={cn(
        "group flex min-w-0 items-center rounded-lg focus-visible:outline-none",
        collapsed ? "justify-center" : "gap-2.5",
        focusRingRaised,
      )}
    >
      <svg
        aria-hidden
        viewBox="0 0 48 38"
        className="h-9 w-11 shrink-0 overflow-visible"
        fill="none"
      >
        <path
          d="M5 4v30h10.5c6 0 10-3.3 10-8.2 0-3.7-2.1-6.1-5.7-7.1 2.8-1.2 4.4-3.5 4.4-6.5C24.2 7.2 20.6 4 15 4H5Zm6.2 5.1h3.1c2.5 0 3.8 1.3 3.8 3.3 0 2.1-1.4 3.4-4 3.4h-2.9V9.1Zm0 11.6h3.9c2.7 0 4.1 1.4 4.1 3.9s-1.5 4.1-4.3 4.1h-3.7v-8Z"
          fill="#C0822A"
        />
        <path
          d="M22.5 4v30H33c6 0 10-3.3 10-8.2 0-3.7-2.1-6.1-5.7-7.1 2.8-1.2 4.4-3.5 4.4-6.5C41.7 7.2 38.1 4 32.5 4h-10Zm6.2 5.1h3.1c2.5 0 3.8 1.3 3.8 3.3 0 2.1-1.4 3.4-4 3.4h-2.9V9.1Zm0 11.6h3.9c2.7 0 4.1 1.4 4.1 3.9s-1.5 4.1-4.3 4.1h-3.7v-8Z"
          className="fill-white/90 transition-colors group-hover:fill-white"
        />
      </svg>
      {!collapsed && (
        <span className="min-w-0 leading-none">
          <span className="block whitespace-nowrap text-[14px] font-black tracking-[0.105em] text-white">
            BROBOND
          </span>
          <span className="mt-1 block text-[8px] font-bold tracking-[0.42em] text-[#D6A45C]">
            WEAR
          </span>
        </span>
      )}
    </Link>
  );
}

const EASE = [...easing.standard] as [number, number, number, number];
const DESKTOP_QUERY = "(min-width: 1024px)";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const activeGroup = findActiveGroup(pathname);
  const settingsActive = isNavItemActive(pathname, settingsNavItem.href);
  const SettingsIcon = settingsNavItem.icon;
  const sidebarRef = React.useRef<HTMLElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  // A persisted desktop collapse preference must never turn the mobile drawer
  // into a 76px icon strip. On small screens the open drawer is always full
  // width and labelled; the preference resumes when the viewport reaches lg.
  const railCollapsed = isDesktop && collapsed;
  const sidebarAvailable = isDesktop || mobileOpen;

  // Treat the mobile rail as a modal disclosure: lock page scroll, move focus
  // inside, contain Tab navigation and restore focus to the trigger on close.
  React.useEffect(() => {
    if (isDesktop || !mobileOpen) return undefined;

    const trigger = document.querySelector<HTMLElement>('[aria-controls="app-sidebar"]');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const animationFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseMobile();
        return;
      }

      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(
        sidebarRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // A mobile→desktop resize hides the trigger; do not move focus to an
      // element that has just become display:none.
      if (!window.matchMedia(DESKTOP_QUERY).matches) trigger?.focus();
    };
  }, [isDesktop, mobileOpen, onCloseMobile]);

  // Groups start expanded; the group owning the active route is force-opened
  // so the current page is always reachable without an extra click.
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(() =>
    Object.fromEntries(navigationGroups.map((group) => [group.id, true])),
  );

  React.useEffect(() => {
    if (!activeGroup) return;
    setOpenGroups((previous) =>
      previous[activeGroup.id] ? previous : { ...previous, [activeGroup.id]: true },
    );
  }, [activeGroup]);

  const toggleGroup = React.useCallback((id: string) => {
    setOpenGroups((previous) => ({ ...previous, [id]: !previous[id] }));
  }, []);

  return (
    <>
      {/* Mobile scrim */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.fast }}
            className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm lg:hidden"
            onClick={onCloseMobile}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <aside
        ref={sidebarRef}
        id="app-sidebar"
        role={!isDesktop && mobileOpen ? "dialog" : undefined}
        aria-modal={!isDesktop && mobileOpen ? true : undefined}
        aria-label="Navegação principal"
        aria-hidden={!sidebarAvailable ? true : undefined}
        inert={!sidebarAvailable ? true : undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/8 shadow-[0_20px_60px_-22px_rgba(0,0,0,0.8)]",
          // PR013 — editorial-luxury rail: solid navy-ink #121827 (surface-900).
          "bg-surface-900/95 backdrop-blur-2xl",
          "transition-[width,transform] duration-200 ease-out",
          railCollapsed ? "w-[72px]" : "w-[min(320px,calc(100vw-24px))] lg:w-[220px]",
          mobileOpen
            ? "translate-x-0"
            : "pointer-events-none -translate-x-full lg:pointer-events-auto",
          "lg:translate-x-0",
        )}
      >
        {/* Decorative brand glow at the top of the rail */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-brand-600/10 via-brand-500/5 to-transparent"
        />

        {/* Official Brobond Wear identity */}
        <div
          className={cn(
            "relative flex h-16 shrink-0 items-center gap-2 border-b border-white/8 px-3",
            railCollapsed && "justify-center px-0",
          )}
        >
          <div className={cn("min-w-0 flex-1", railCollapsed && "flex-none")}>
            <BrandLockup collapsed={railCollapsed} />
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onCloseMobile}
            className={cn(
              "rounded-lg p-2 text-white/50 transition-colors hover:bg-white/[0.07] hover:text-white lg:hidden",
              focusRingRaised,
            )}
            aria-label="Fechar menu de navegação"
          >
            <X aria-hidden className="h-5 w-5" />
          </button>
        </div>

        {/* Grouped nav */}
        <nav
          aria-label="Módulos"
          className="scrollbar-thin relative flex-1 space-y-1 overflow-y-auto px-3 py-4"
        >
          {navigationGroups.map((group) => {
            const expanded = openGroups[group.id] ?? true;
            const groupHasActive = group.items.some((item) => isNavItemActive(pathname, item.href));

            return (
              <div key={group.id} className="pb-1">
                {!railCollapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={expanded}
                    aria-controls={`nav-group-${group.id}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      "transition-colors duration-150 hover:bg-white/[0.04]",
                      groupHasActive ? "text-ink-300" : "text-ink-500 hover:text-ink-400",
                      focusRingRaised,
                    )}
                  >
                    <span className="flex h-5 w-5 items-center justify-center rounded-md border border-white/8 bg-white/[0.02]">
                      <group.icon aria-hidden className="h-2.5 w-2.5 text-ink-400" />
                    </span>
                    <span className="flex-1 text-left">{group.label}</span>
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "h-3 w-3 shrink-0 transition-transform duration-200",
                        expanded ? "rotate-0" : "-rotate-90",
                      )}
                    />
                  </button>
                ) : (
                  <div
                    aria-hidden
                    className="mx-auto my-2 h-px w-8 bg-white/8 first:mt-0"
                    title={group.label}
                  />
                )}

                <AnimatePresence initial={false}>
                  {(expanded || railCollapsed) && (
                    <motion.ul
                      id={`nav-group-${group.id}`}
                      initial={reducedMotion || railCollapsed ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: duration.normal, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <li className={cn("space-y-0.5", !railCollapsed && "pt-1")}>
                        {group.items.map((item) => {
                          // PR014 — an exact href match wins over a prefix
                          // match, so the isolated provider screen highlights
                          // only its own link (not the parent hub as well).
                          const active = isNavItemSelected(pathname, item);
                          const Icon = item.icon;

                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={onCloseMobile}
                              aria-current={active ? "page" : undefined}
                              title={railCollapsed ? item.label : undefined}
                              className={cn(
                                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                                "transition-[background-color,color,box-shadow] duration-150",
                                active
                                  ? "bg-gradient-to-r from-brand-500/14 to-transparent text-white shadow-[inset_1px_0_0_rgba(192,130,42,0.75)]"
                                  : "text-ink-400 hover:bg-white/[0.06] hover:text-white",
                                railCollapsed && "justify-center px-0",
                                focusRingRaised,
                              )}
                            >
                              {/* Active indicator rail */}
                              {active && (
                                <span
                                  aria-hidden
                                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-400"
                                />
                              )}

                              <Icon
                                aria-hidden
                                className={cn(
                                  "h-[18px] w-[18px] shrink-0 transition-colors",
                                  active
                                    ? "text-brand-300"
                                    : "text-ink-400 group-hover:text-white/80",
                                )}
                              />

                              {!railCollapsed && (
                                <>
                                  <span className="truncate">{item.label}</span>
                                  {item.badge && (
                                    <Badge tone={item.badge.tone} className="ml-auto">
                                      {item.badge.label}
                                    </Badge>
                                  )}
                                  {!item.badge && item.planned && (
                                    <Badge tone="neutral" className="ml-auto">
                                      em breve
                                    </Badge>
                                  )}
                                </>
                              )}

                              {railCollapsed && (item.badge || item.planned) && (
                                <span
                                  aria-hidden
                                  className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-brand-400"
                                />
                              )}
                            </Link>
                          );
                        })}
                      </li>
                    </motion.ul>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </nav>

        {/* Minimal utility footer */}
        <div className="relative shrink-0 space-y-1 border-t border-white/8 p-3">
          <Link
            href={settingsNavItem.href}
            onClick={onCloseMobile}
            aria-current={settingsActive ? "page" : undefined}
            title={railCollapsed ? settingsNavItem.label : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
              "transition-[background-color,color,box-shadow] duration-150",
              settingsActive
                ? "bg-[#C0822A]/14 text-white shadow-[inset_1px_0_0_rgba(192,130,42,0.75)]"
                : "text-ink-400 hover:bg-white/[0.06] hover:text-white",
              railCollapsed && "justify-center px-0",
              focusRingRaised,
            )}
          >
            {settingsActive && (
              <span
                aria-hidden
                className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[#C0822A]"
              />
            )}
            <SettingsIcon
              aria-hidden
              className={cn(
                "h-[18px] w-[18px] shrink-0",
                settingsActive ? "text-[#D6A45C]" : "text-ink-400 group-hover:text-white/80",
              )}
            />
            {!railCollapsed && <span>{settingsNavItem.label}</span>}
          </Link>

          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!railCollapsed}
            aria-controls="app-sidebar"
            className={cn(
              "hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-400",
              "transition-colors duration-150 hover:bg-white/[0.06] hover:text-white lg:flex",
              railCollapsed && "justify-center px-0",
              focusRingRaised,
            )}
          >
            {railCollapsed ? (
              <>
                <PanelLeft aria-hidden className="h-[18px] w-[18px]" />
                <span className="sr-only">Expandir navegação</span>
              </>
            ) : (
              <>
                <PanelLeftClose aria-hidden className="h-[18px] w-[18px]" />
                <span>Recolher</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
