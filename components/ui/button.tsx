import * as React from "react";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

/**
 * Button (PR010.1).
 *
 * Enterprise control surface: 12px radius, 150ms transitions, a brand gradient
 * for the primary action and a keyboard-only focus ring at AA contrast. The
 * `variant`/`size` union is a superset of the PR000 API — existing call sites
 * are unaffected.
 */

type Variant = "primary" | "secondary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "xs" | "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-[0_8px_24px_-10px_rgba(79,70,229,0.9)] " +
    "hover:from-brand-400 hover:to-brand-500 active:from-brand-600 active:to-brand-700",
  secondary: "bg-white/[0.08] text-white hover:bg-white/[0.14] active:bg-white/[0.18]",
  ghost: "bg-transparent text-white/70 hover:bg-white/[0.07] hover:text-white",
  outline:
    "border border-white/12 bg-white/[0.02] text-white/85 hover:border-white/20 hover:bg-white/[0.06] hover:text-white",
  subtle: "bg-brand-500/12 text-brand-200 hover:bg-brand-500/20",
  danger:
    "bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/25 hover:border-red-500/40",
};

const sizes: Record<Size, string> = {
  xs: "h-7 gap-1.5 px-2.5 text-[11px]",
  sm: "h-8 gap-1.5 px-3 text-xs",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-11 gap-2 px-6 text-sm",
  icon: "h-10 w-10",
  "icon-sm": "h-8 w-8",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-xl font-medium",
        "transition-[background,border-color,color,box-shadow,transform] duration-150 ease-out",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        focusRing,
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
