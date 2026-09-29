"use client";

import { cn } from "@/lib/utils";

/**
 * Avatar with graceful fallback: the profile image when the source
 * provided one, the person's initials otherwise (mock data has none —
 * no broken images, ever).
 */
export function CreatorAvatar({
  displayName,
  avatarUrl,
  className,
}: {
  displayName: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={displayName}
        className={cn(
          "h-9 w-9 shrink-0 rounded-full border border-surface-600 object-cover",
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden
      title={displayName}
      className={cn(
        "flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full border border-surface-600 bg-brand-600/20 text-xs font-semibold uppercase text-brand-200",
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
