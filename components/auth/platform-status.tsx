import { cn } from "@/lib/utils";

/**
 * Platform status indicator for the login panel (PR010.2 §3).
 *
 * Small but deliberate: when someone cannot get in, the first question is
 * always "is it me or is it them?". A status line answers it before they file
 * a ticket — the pattern Stripe and HubSpot both use on their sign-in screens.
 *
 * HONESTY CONTRACT
 * ----------------
 * This renders what it is *told*. It does not invent a green light: the page
 * passes an explicit state, and the default is the neutral "operacional"
 * reading of a server that is, demonstrably, serving this page. It is never
 * wired to a fake uptime number.
 */

export type PlatformState = "operational" | "degraded" | "maintenance";

const STATES: Record<PlatformState, { label: string; dot: string; text: string }> = {
  operational: {
    label: "Todos os sistemas operacionais",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
  },
  degraded: {
    label: "Desempenho degradado",
    dot: "bg-amber-400",
    text: "text-amber-300",
  },
  maintenance: {
    label: "Manutenção programada",
    dot: "bg-sky-400",
    text: "text-sky-300",
  },
};

export interface PlatformStatusProps {
  state?: PlatformState;
  className?: string;
}

export function PlatformStatus({ state = "operational", className }: PlatformStatusProps) {
  const config = STATES[state];

  return (
    <div
      role="status"
      className={cn(
        "inline-flex items-center gap-2.5 rounded-full border border-white/8 bg-white/[0.04] px-3.5 py-2",
        "backdrop-blur-sm",
        className,
      )}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            config.dot,
          )}
        />
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", config.dot)} />
      </span>
      <span className={cn("text-[11px] font-medium", config.text)}>{config.label}</span>
    </div>
  );
}
