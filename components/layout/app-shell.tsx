"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { useSidebar } from "@/hooks/use-sidebar";
import { cn } from "@/lib/utils";

/**
 * Authenticated application shell: collapsible sidebar + fixed header.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggleCollapsed, mobileOpen, toggleMobile, closeMobile } = useSidebar();

  return (
    <div className="min-h-screen bg-surface-950">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={closeMobile}
      />
      <div
        className={cn(
          "flex min-h-screen flex-col transition-[padding] duration-200 ease-in-out",
          collapsed ? "lg:pl-[76px]" : "lg:pl-64",
        )}
      >
        <Header onOpenMobile={toggleMobile} />
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
