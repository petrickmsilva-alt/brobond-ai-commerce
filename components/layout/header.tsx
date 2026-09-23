"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, Plus, Search } from "lucide-react";
import { CommandPalette } from "@/components/layout/command-palette";
import { NotificationsMenu } from "@/components/layout/notifications-menu";
import { UserMenu, type UserMenuProps } from "@/components/layout/user-menu";
import { ConnectionStatus, type ConnectionState } from "@/components/layout/connection-status";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * Header (PR010.1) — sticky application chrome.
 *
 * Contents: mobile nav trigger · global search trigger (⌘K / Ctrl+K) ·
 * TikTok Shop connection status · "Nova Campanha" primary CTA ·
 * notifications · account menu.
 *
 * The ⌘K listener is registered once here (not per-component) and ignores the
 * shortcut while the user is typing in a field, so it never hijacks input.
 */

interface HeaderProps {
  onOpenMobile: () => void;
  /** Mirrors the off-canvas disclosure state for assistive technology. */
  mobileOpen: boolean;
  user: UserMenuProps;
  /** TikTok Shop connection state, resolved server-side. */
  tiktokStatus?: ConnectionState;
}

export function Header({ onOpenMobile, mobileOpen, user, tiktokStatus = "unknown" }: HeaderProps) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(window.navigator.platform));
  }, []);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;

      // Never steal the shortcut from a field the user is editing.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
        return;
      }

      event.preventDefault();
      setPaletteOpen((open) => !open);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 px-4 lg:px-6",
          "border-b border-white/8 bg-surface-950/70 backdrop-blur-xl",
        )}
      >
        <button
          type="button"
          onClick={onOpenMobile}
          aria-label={mobileOpen ? "Fechar menu de navegação" : "Abrir menu de navegação"}
          aria-controls="app-sidebar"
          aria-expanded={mobileOpen}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl text-white/60",
            "transition-colors hover:bg-white/[0.07] hover:text-white lg:hidden",
            focusRingRaised,
          )}
        >
          <Menu aria-hidden className="h-5 w-5" />
        </button>

        {/* Global search trigger — opens the command palette. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-haspopup="dialog"
          className={cn(
            "group hidden h-9 max-w-sm flex-1 items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 text-left",
            "transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.06] md:flex",
            focusRingRaised,
          )}
        >
          <Search aria-hidden className="h-4 w-4 shrink-0 text-white/35" />
          <span className="flex-1 truncate text-sm text-white/40 group-hover:text-white/55">
            Buscar módulos, páginas e ações…
          </span>
          <kbd className="shrink-0 rounded-md border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-white/40">
            {isMac ? "⌘" : "Ctrl"} K
          </kbd>
        </button>

        {/* Compact search trigger on small screens. */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Abrir busca global"
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl text-white/55",
            "transition-colors hover:bg-white/[0.07] hover:text-white md:hidden",
            focusRingRaised,
          )}
        >
          <Search aria-hidden className="h-[18px] w-[18px]" />
        </button>

        <div className="ml-auto flex items-center gap-2">
          <ConnectionStatus
            className="hidden lg:flex"
            label="TikTok Shop"
            state={tiktokStatus}
            href="/dashboard/tiktok"
          />

          <Link
            href="/dashboard/campaigns"
            className={cn(
              "hidden h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-white sm:inline-flex",
              "bg-gradient-to-b from-brand-500 to-brand-600 shadow-[0_8px_24px_-10px_rgba(79,70,229,0.9)]",
              "transition-[background,transform] duration-150 hover:from-brand-400 hover:to-brand-500 active:scale-[0.985]",
              focusRingRaised,
            )}
          >
            <Plus aria-hidden className="h-4 w-4" />
            Nova Campanha
          </Link>

          {/* Icon-only CTA below the `sm` breakpoint. */}
          <Link
            href="/dashboard/campaigns"
            aria-label="Nova campanha"
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl text-white sm:hidden",
              "bg-gradient-to-b from-brand-500 to-brand-600",
              focusRingRaised,
            )}
          >
            <Plus aria-hidden className="h-4 w-4" />
          </Link>

          <NotificationsMenu />

          <UserMenu {...user} />
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
