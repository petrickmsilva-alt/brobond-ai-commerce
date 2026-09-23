import * as React from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Input (PR010.1) — 12px radius, sunken surface, AA placeholder contrast and
 * a keyboard-only focus ring. `aria-invalid` paints the error state so form
 * validation is communicated without relying on colour alone.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-xl border border-white/10 bg-surface-900/80 px-3.5 py-2 text-sm text-white",
        "placeholder:text-white/40 transition-[border-color,background-color,box-shadow] duration-150",
        "hover:border-white/16 focus-visible:border-brand-400/60",
        "aria-[invalid=true]:border-red-400/50 aria-[invalid=true]:focus-visible:ring-red-400",
        "disabled:cursor-not-allowed disabled:opacity-45",
        focusRing,
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
