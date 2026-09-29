import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge (PR010.1) — compact status/labelling pill.
 *
 * Tones carry a tinted background, a matching border and a foreground at
 * WCAG AA contrast over the dark surfaces. Colour is never the only signal:
 * callers always pair the tone with text.
 *
 * The PR000 tones (`brand` / `neutral` / `success` / `warning`) are preserved;
 * `danger`, `info` and `accent` are additive.
 */

type Tone = "brand" | "neutral" | "success" | "warning" | "danger" | "info" | "accent";
type BadgeSize = "sm" | "md";

const tones: Record<Tone, string> = {
  brand: "bg-brand-500/14 text-brand-200 border-brand-400/30",
  neutral: "bg-white/[0.06] text-white/65 border-white/10",
  success: "bg-emerald-500/14 text-emerald-300 border-emerald-400/30",
  warning: "bg-amber-500/14 text-amber-300 border-amber-400/30",
  danger: "bg-red-500/14 text-red-300 border-red-400/30",
  info: "bg-sky-500/14 text-sky-300 border-sky-400/30",
  accent: "bg-accent-500/14 text-accent-300 border-accent-400/30",
};

const sizes: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-[11px]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: BadgeSize;
  /** Renders a leading status dot in the tone's colour. */
  dot?: boolean;
}

export function Badge({
  tone = "neutral",
  size = "sm",
  dot,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium leading-none",
        tones[tone],
        sizes[size],
        className,
      )}
      {...props}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
