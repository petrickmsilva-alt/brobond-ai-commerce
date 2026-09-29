"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { focusRingRaised } from "@/components/ui/design-system/theme";

/**
 * ConnectionStatus (PR010.1) — integration health pill for the header.
 *
 * Presentation only: the state is computed server-side (the TikTok Shop
 * account row is ADMIN-scoped and never exposed to the client beyond this
 * single enum) and passed down as a prop. No token, shop id or credential is
 * ever part of this component's props.
 *
 * Status is conveyed by colour AND by text, and the whole pill is a link to
 * the integration page so it is operable by keyboard.
 */

export type ConnectionState = "connected" | "disconnected" | "error" | "unknown";

const states: Record<ConnectionState, { dot: string; text: string; label: string; title: string }> =
  {
    connected: {
      dot: "bg-emerald-400",
      text: "text-emerald-300",
      label: "Conectado",
      title: "Integração ativa e sincronizando",
    },
    disconnected: {
      dot: "bg-white/35",
      text: "text-white/50",
      label: "Desconectado",
      title: "Integração não conectada",
    },
    error: {
      dot: "bg-red-400",
      text: "text-red-300",
      label: "Erro",
      title: "A integração precisa de atenção",
    },
    unknown: {
      dot: "bg-white/25",
      text: "text-white/40",
      label: "—",
      title: "Status indisponível",
    },
  };

interface ConnectionStatusProps {
  label: string;
  state: ConnectionState;
  /** Destination of the integration's settings page. */
  href: string;
  className?: string;
}

export function ConnectionStatus({ label, state, href, className }: ConnectionStatusProps) {
  const style = states[state];

  return (
    <Link
      href={href}
      title={`${label}: ${style.title}`}
      className={cn(
        "flex h-9 items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3",
        "transition-colors duration-150 hover:border-white/15 hover:bg-white/[0.06]",
        focusRingRaised,
        className,
      )}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {state === "connected" && (
          <span
            aria-hidden
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"
          />
        )}
        <span aria-hidden className={cn("relative inline-flex h-2 w-2 rounded-full", style.dot)} />
      </span>
      <span className="text-xs font-medium text-white/70">{label}</span>
      <span className={cn("text-xs font-semibold", style.text)}>{style.label}</span>
    </Link>
  );
}
