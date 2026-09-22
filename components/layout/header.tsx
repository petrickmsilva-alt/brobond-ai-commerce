"use client";

import { Menu, Bell, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface HeaderProps {
  onOpenMobile: () => void;
}

export function Header({ onOpenMobile }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-surface-800 bg-surface-900/80 px-4 backdrop-blur-lg lg:px-6">
      <button
        onClick={onOpenMobile}
        className="rounded-md p-2 text-white/60 hover:bg-surface-800 hover:text-white lg:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <Input placeholder="Buscar produtos, creators, campanhas…" className="pl-9" />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          className="relative rounded-lg p-2 text-white/60 hover:bg-surface-800 hover:text-white"
          aria-label="Notificações"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-brand-500" />
        </button>
        <div className="flex items-center gap-2.5 rounded-lg border border-surface-700 bg-surface-850 py-1.5 pl-1.5 pr-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
            BA
          </div>
          <div className="hidden flex-col leading-tight sm:flex">
            <span className="text-xs font-medium text-white">Brobond Admin</span>
            <span className="text-[10px] text-white/40">admin@brobond.ai</span>
          </div>
        </div>
      </div>
    </header>
  );
}
