"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";
import { duration, easing } from "@/components/ui/design-system/tokens";

/**
 * UserMenu (PR010.1) — header avatar + account dropdown.
 *
 * Receives only non-secret, already-sanitised session fields (name, email,
 * role) from a Server Component; it never reads the session itself and never
 * touches a token. Sign-out posts to NextAuth's own route so the session
 * cookie is cleared server-side.
 */

const EASE = [...easing.standard] as [number, number, number, number];

export interface UserMenuProps {
  name: string;
  email: string;
  /** Tenant role label, e.g. "ADMIN". */
  role?: string;
  /** Avatar image URL, when the account has one. */
  image?: string | null;
}

function initials(name: string, email: string): string {
  const source = name.trim() || email.trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserMenu({ name, email, role, image }: UserMenuProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
        aria-haspopup="menu"
        aria-label={`Conta de ${name}`}
        className={cn(
          "flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] py-1 pl-1 pr-2",
          "transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.07]",
          focusRingRaised,
        )}
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are arbitrary remote hosts; no optimisation pipeline is warranted for a 28px chrome element.
          <img
            src={image}
            alt=""
            className="h-7 w-7 shrink-0 rounded-lg object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-600 text-[11px] font-bold text-white"
          >
            {initials(name, email)}
          </span>
        )}

        <span className="hidden min-w-0 flex-col items-start leading-tight sm:flex">
          <span className="max-w-[10rem] truncate text-xs font-medium text-white">{name}</span>
          <span className="max-w-[10rem] truncate text-[10px] text-white/40">{email}</span>
        </span>

        <ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-white/35" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Menu da conta"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: duration.fast, ease: EASE }}
            className="glass-panel absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl"
          >
            <div className="border-b border-white/8 px-4 py-3">
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <p className="truncate text-xs text-white/45">{email}</p>
              {role && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60">
                  <ShieldCheck aria-hidden className="h-3 w-3" />
                  {role}
                </p>
              )}
            </div>

            <div className="p-1.5">
              <Link
                href="/settings"
                role="menuitem"
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/70",
                  "transition-colors hover:bg-white/[0.06] hover:text-white",
                  focusRingRaised,
                )}
              >
                <Settings aria-hidden className="h-4 w-4" />
                Configurações
              </Link>

              {/* NextAuth's own sign-out endpoint renders the CSRF-protected
                  confirmation form; the session cookie is cleared server-side.
                  It is a route handler, not an app page, so it needs a real
                  document navigation — a client-side <Link> would not clear
                  the cookie. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/api/auth/signout"
                role="menuitem"
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/70",
                  "transition-colors hover:bg-red-500/10 hover:text-red-300",
                  focusRingRaised,
                )}
              >
                <LogOut aria-hidden className="h-4 w-4" />
                Sair
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
