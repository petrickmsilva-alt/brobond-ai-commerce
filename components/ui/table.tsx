import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Table (PR010.1) — enterprise data grid chrome: sticky-ready header on a
 * sunken surface, hairline row dividers and a quiet hover highlight. The
 * scroll container is keyboard-focusable so horizontal overflow stays
 * operable without a mouse (WCAG 2.1.1).
 */

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="scrollbar-thin w-full overflow-x-auto rounded-xl" tabIndex={0}>
      <table
        className={cn("w-full caption-bottom border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-white/8 bg-white/[0.02] backdrop-blur-sm", className)}
      {...props}
    />
  );
}

export function TableBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-white/[0.06]", className)} {...props} />;
}

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors duration-150 hover:bg-white/[0.035]", className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        "h-11 whitespace-nowrap px-4 text-left align-middle text-[11px] font-semibold uppercase tracking-wider text-white/50",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3.5 align-middle text-white/80", className)} {...props} />;
}
