"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown, PanelLeft, PanelLeftClose, X } from "lucide-react";
import { navigationGroups, isNavItemActive, findActiveGroup } from "@/lib/navigation";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher";
import { Badge } from "@/components/ui/badge";
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
 * - Workspace switcher in the brand slot.
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
  workspace: WorkspaceOption;
}

const EASE = [...easing.standard] as [number, number, number, number];

export function Sidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
  workspace,
}: SidebarProps) {
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const activeGroup = findActiveGroup(pathname);

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
        id="app-sidebar"
        aria-label="Navegação principal"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-white/8",
          "bg-surface-900/85 backdrop-blur-xl",
          "transition-[width,transform] duration-200 ease-out",
          collapsed ? "w-[76px]" : "w-[264px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
      >
        {/* Decorative brand glow at the top of the rail */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-brand-600/10 to-transparent"
        />

        {/* Brand / workspace */}
        <div
          className={cn(
            "relative flex h-16 shrink-0 items-center gap-2 border-b border-white/8 px-3",
            collapsed && "justify-center px-0",
          )}
        >
          <div className={cn("min-w-0 flex-1", collapsed && "flex-none")}>
            <WorkspaceSwitcher workspace={workspace} collapsed={collapsed} />
          </div>

          <button
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
                {!collapsed ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={expanded}
                    aria-controls={`nav-group-${group.id}`}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                      "transition-colors duration-150 hover:bg-white/[0.04]",
                      groupHasActive ? "text-white/60" : "text-white/35 hover:text-white/55",
                      focusRingRaised,
                    )}
                  >
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
                  {(expanded || collapsed) && (
                    <motion.ul
                      id={`nav-group-${group.id}`}
                      initial={reducedMotion || collapsed ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                      transition={{ duration: duration.normal, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <li className={cn("space-y-0.5", !collapsed && "pt-1")}>
                        {group.items.map((item) => {
                          const active = isNavItemActive(pathname, item.href);
                          const Icon = item.icon;

                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              onClick={onCloseMobile}
                              aria-current={active ? "page" : undefined}
                              title={collapsed ? item.label : undefined}
                              className={cn(
                                "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
                                "transition-[background-color,color] duration-150",
                                active
                                  ? "bg-brand-500/14 text-white"
                                  : "text-white/60 hover:bg-white/[0.06] hover:text-white",
                                collapsed && "justify-center px-0",
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
                                    : "text-white/45 group-hover:text-white/80",
                                )}
                              />

                              {!collapsed && (
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

                              {collapsed && (item.badge || item.planned) && (
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

        {/* Collapse toggle */}
        <div className="relative shrink-0 border-t border-white/8 p-3">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            className={cn(
              "hidden w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/45",
              "transition-colors duration-150 hover:bg-white/[0.06] hover:text-white lg:flex",
              collapsed && "justify-center px-0",
              focusRingRaised,
            )}
          >
            {collapsed ? (
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
