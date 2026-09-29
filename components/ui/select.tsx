import * as React from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Select (PR010.1) — matches `Input`'s geometry and states, with a custom
 * chevron drawn as an inline SVG background so the control looks identical
 * across browsers on the dark theme.
 */
const CHEVRON =
  "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='rgba(255,255,255,0.5)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")";

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, style, ...props }, ref) => (
    <select
      ref={ref}
      style={{
        backgroundImage: CHEVRON,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 12px center",
        ...style,
      }}
      className={cn(
        "flex h-10 w-full appearance-none rounded-xl border border-white/10 bg-surface-900/80 py-2 pl-3.5 pr-9 text-sm text-white",
        "transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-white/16 focus-visible:border-brand-400/60",
        "disabled:cursor-not-allowed disabled:opacity-45",
        "[&>option]:bg-surface-900 [&>option]:text-white",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
