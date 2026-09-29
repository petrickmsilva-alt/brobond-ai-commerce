"use client";

import * as React from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import type { UserMenuProps } from "@/components/layout/user-menu";
import type { ConnectionState } from "@/components/layout/connection-status";
import type { WorkspaceOption } from "@/components/layout/workspace-switcher";
import { useSidebar } from "@/hooks/use-sidebar";
import { cn } from "@/lib/utils";

/**
 * AppShell (PR010.1) — authenticated application frame.
 *
 * Grid: fixed navigation rail (264px / 76px collapsed) + sticky header +
 * fluid content column capped at 1600px so an ultrawide monitor doesn't
 * stretch tables into unreadable lines.
 *
 * Every prop is already-sanitised, non-secret session data resolved by the
 * Server Component layout (`app/dashboard/layout.tsx`): this client component
 * never reads the session, the database or an environment variable.
 *
 * A skip link is the first tab stop so keyboard users can jump past the rail
 * straight to `<main>` (WCAG 2.4.1).
 */

export interface AppShellProps {
  children: React.ReactNode;
  user: UserMenuProps;
  workspace: WorkspaceOption;
  tiktokStatus?: ConnectionState;
}

export function AppShell({ children, user, workspace, tiktokStatus }: AppShellProps) {
  const { collapsed, toggleCollapsed, mobileOpen, toggleMobile, closeMobile } = useSidebar();

  // Close the off-canvas rail when the viewport grows past the `lg` breakpoint
  // so the mobile state can never leak into the desktop layout.
  React.useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const onChange = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) closeMobile();
    };
    onChange(query);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [closeMobile]);

  return (
    <div className="bg-app-mesh relative min-h-screen overflow-x-hidden isolate">
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-90" />

      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
        workspace={workspace}
      />

      <div
        aria-hidden={mobileOpen ? true : undefined}
        inert={mobileOpen ? true : undefined}
        className={cn(
          "relative z-10 flex min-h-screen flex-col transition-[padding] duration-200 ease-out",
          collapsed ? "lg:pl-[76px]" : "lg:pl-[264px]",
        )}
      >
        <Header
          onOpenMobile={toggleMobile}
          mobileOpen={mobileOpen}
          user={user}
          tiktokStatus={tiktokStatus}
        />

        <main
          id="main-content"
          tabIndex={-1}
          className="focus:outline-none"
        >
          <div className="mx-auto w-full max-w-[1560px] px-4 pb-8 pt-5 sm:px-6 lg:px-8 lg:pt-8">
            <div className="relative rounded-[24px] border border-white/8 bg-surface-950/35 p-0 shadow-[0_12px_40px_-18px_rgba(10,10,15,0.9)] backdrop-blur-sm">
              <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/12 to-transparent" />
              <div className="relative">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
