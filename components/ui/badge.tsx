import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "neutral" | "success" | "warning";

const tones: Record<Tone, string> = {
  brand: "bg-brand-600/15 text-brand-300 border-brand-500/30",
  neutral: "bg-surface-700/60 text-white/60 border-surface-600",
  success: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
