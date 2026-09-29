import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Card — the product's signature surface (PR010.1).
 *
 * 16px radius, hairline border, a subtle top-down gradient wash and a soft
 * elevation shadow. `variant` switches between the default raised surface, a
 * frosted glass panel and a flat/quiet container.
 *
 * The public API (Card / CardHeader / CardTitle / CardContent) is unchanged
 * from PR000 so every existing page keeps rendering without edits.
 */

type CardVariant = "default" | "glass" | "flat";

const cardVariants: Record<CardVariant, string> = {
  default:
    "border-white/8 bg-surface-850 bg-gradient-to-b from-white/[0.045] to-transparent " +
    "shadow-[0_8px_24px_-8px_rgba(0,0,0,0.45)]",
  glass:
    "border-white/10 bg-surface-850/70 backdrop-blur-xl " +
    "shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]",
  flat: "border-white/8 bg-surface-900/60",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Adds an elegant border/shadow lift on hover. */
  interactive?: boolean;
}

export function Card({ className, variant = "default", interactive, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "glass-edge relative overflow-hidden rounded-2xl border",
        cardVariants[variant],
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 ease-out " +
            "hover:-translate-y-0.5 hover:border-white/15 hover:shadow-[0_16px_48px_-12px_rgba(0,0,0,0.55)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-start justify-between gap-4 px-6 pb-0 pt-6", className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-sm font-semibold tracking-tight text-white/90", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-xs leading-relaxed text-white/50", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-3 border-t border-white/8 px-6 py-4", className)}
      {...props}
    />
  );
}
