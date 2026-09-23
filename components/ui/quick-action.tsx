import * as React from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusRing } from "@/components/ui/design-system/theme";

/**
 * QuickAction (PR010.1) — launcher tile for a high-frequency task.
 *
 * SERVER COMPONENT BY DESIGN. Quick actions are rendered from Server
 * Components (dashboards, empty states) that pass a Lucide `icon`, and a
 * component reference cannot cross the server→client boundary — making this
 * a Client Component would throw "Functions cannot be passed directly to
 * Client Components" at render time. It holds no state and needs no
 * interactivity beyond navigation, so it renders a plain `next/link`.
 *
 * For the rare action that must run a client callback instead of navigating,
 * use `QuickActionButton` (below) and pass the icon as a rendered element.
 *
 * The whole tile is a single focusable target (no nested interactive
 * elements), so keyboard and screen-reader users get exactly one stop.
 */

const tileClasses =
  "group relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border border-white/8 " +
  "bg-surface-850 bg-gradient-to-b from-white/[0.04] to-transparent p-4 text-left " +
  "transition-[border-color,background-color,transform,box-shadow] duration-200 ease-out " +
  "hover:-translate-y-0.5 hover:border-brand-400/30 hover:bg-surface-800 " +
  "hover:shadow-[0_16px_40px_-16px_rgba(79,70,229,0.55)] " +
  "aria-disabled:pointer-events-none aria-disabled:opacity-45 disabled:pointer-events-none disabled:opacity-45";

interface QuickActionBodyProps {
  label: string;
  description?: string;
  /** Pre-rendered icon element (so the client variant needs no component ref). */
  iconSlot: React.ReactNode;
  badge?: React.ReactNode;
}

function QuickActionBody({ label, description, iconSlot, badge }: QuickActionBodyProps) {
  return (
    <>
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-brand-500/12 text-brand-300 transition-colors duration-200 group-hover:bg-brand-500/20 group-hover:text-brand-200"
      >
        {iconSlot}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-white">{label}</span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-white/45">{description}</span>
        )}
      </span>

      {badge}

      <ArrowRight
        aria-hidden
        className="h-4 w-4 shrink-0 text-white/25 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:text-brand-300"
      />
    </>
  );
}

export interface QuickActionProps {
  label: string;
  description?: string;
  icon: LucideIcon;
  href: string;
  /** Optional trailing count/status pill. */
  badge?: React.ReactNode;
  /** Renders the tile inert (e.g. the viewer's role can't perform the action). */
  disabled?: boolean;
  className?: string;
}

export function QuickAction({
  label,
  description,
  icon: Icon,
  href,
  badge,
  disabled,
  className,
}: QuickActionProps) {
  return (
    <Link
      href={href}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(tileClasses, focusRing, className)}
    >
      <QuickActionBody
        label={label}
        description={description}
        badge={badge}
        iconSlot={<Icon className="h-5 w-5" />}
      />
    </Link>
  );
}

export interface QuickActionButtonProps {
  label: string;
  description?: string;
  /** Rendered icon element, e.g. `<Package className="h-5 w-5" />`. */
  icon: React.ReactNode;
  onClick: () => void;
  badge?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Button flavour of `QuickAction` for client-side callbacks. The icon is a
 * ReactNode (not a component reference) precisely so this stays usable from
 * a Client Component without breaking RSC serialization.
 */
export function QuickActionButton({
  label,
  description,
  icon,
  onClick,
  badge,
  disabled,
  className,
}: QuickActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(tileClasses, focusRing, className)}
    >
      <QuickActionBody label={label} description={description} badge={badge} iconSlot={icon} />
    </button>
  );
}
