"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilterX, Inbox, Package, Users, Wallet, type LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";

/**
 * TableEmptyState (PR010.2 §10) — "Quando não houver dados: mostrar CTA."
 *
 * THE DISTINCTION THAT MATTERS
 * ----------------------------
 * "No rows" has two completely different causes, and offering the wrong
 * remedy is worse than offering none:
 *
 *   1. The workspace genuinely has no data yet → offer the action that
 *      CREATES data ("Importar produtos", "Sincronizar TikTok", "Criar
 *      campanha"). This is the onboarding moment.
 *   2. The user's filters excluded everything → offering "create" is noise;
 *      what they need is a way back to the unfiltered list.
 *
 * This component reads the URL's own search params to tell the two apart, so
 * every table gets the right CTA without each page re-deriving it.
 *
 * The CTA is passed in by the caller because only the page knows what the
 * user is permitted to do — RBAC stays where it belongs (§11), and a MEMBER
 * is never shown a button that would fail server-side.
 *
 * SERIALIZABLE ICON CONTRACT (PR016)
 * ----------------------------------
 * This is a Client Component, so it may NEVER receive a lucide icon as a
 * prop from a Server Component — a component reference is a function, and
 * functions cannot cross the server→client boundary ("Functions cannot be
 * passed directly to Client Components"; this exact mistake crashed the
 * isolated connector screens with the global error screen). Callers pass a
 * plain STRING identifier via `iconName`; the icon is resolved from the
 * registry below, INSIDE this Client Component. The literal-union type makes
 * an unknown identifier a compile-time error instead of a runtime hole.
 */

/**
 * The icons this empty state may show, keyed by their serializable
 * identifiers. Rendered only on the client — the values never travel
 * through the RSC payload.
 */
const ICONS = {
  inbox: Inbox,
  package: Package,
  users: Users,
  wallet: Wallet,
} as const satisfies Record<string, LucideIcon>;

/** Serializable icon identifier accepted by `TableEmptyState` (PR016). */
export type TableEmptyStateIconName = keyof typeof ICONS;

/** Query keys that mean "the user narrowed this list". */
const FILTER_KEYS = [
  "q",
  "search",
  "status",
  "source",
  "platform",
  "type",
  "channel",
  "campaign",
  "tone",
  "minScore",
  "maxScore",
  "from",
  "to",
];

export interface TableEmptyStateProps {
  /**
   * Icon for the "no data at all" case — a plain string so Server Components
   * can pass it across the RSC boundary (PR016). Resolved to the lucide
   * component inside this Client Component; unknown identifiers are
   * compile-time errors. Omit it to keep EmptyState's default (Inbox).
   */
  iconName?: TableEmptyStateIconName;
  /** Headline when the workspace has no data yet. */
  title: string;
  /** Supporting copy for the same case. */
  description?: string;
  /** Primary CTA — the action that creates the first record. */
  action?: React.ReactNode;
  /** Headline when filters are responsible. */
  filteredTitle?: string;
  filteredDescription?: string;
  /** Where "Limpar filtros" points. Defaults to the current path. */
  clearFiltersHref?: string;
}

export function TableEmptyState({
  iconName,
  title,
  description,
  action,
  filteredTitle = "Nenhum resultado para esses filtros",
  filteredDescription = "Tente ampliar a busca ou limpar os filtros aplicados.",
  clearFiltersHref,
}: TableEmptyStateProps) {
  const searchParams = useSearchParams();

  const hasFilters = React.useMemo(
    () => FILTER_KEYS.some((key) => (searchParams.get(key) ?? "").trim() !== ""),
    [searchParams],
  );

  if (hasFilters) {
    return (
      <EmptyState
        size="md"
        bordered={false}
        icon={FilterX}
        title={filteredTitle}
        description={filteredDescription}
        action={
          <Link href={clearFiltersHref ?? "?"}>
            <Button variant="outline" size="sm">
              <FilterX aria-hidden className="h-4 w-4" />
              Limpar filtros
            </Button>
          </Link>
        }
      />
    );
  }

  // PR016 — the lucide component is resolved HERE, on the client, from the
  // serializable identifier; only the string ever crossed the boundary.
  const Icon = iconName ? ICONS[iconName] : undefined;

  return (
    <EmptyState
      size="md"
      bordered={false}
      icon={Icon}
      title={title}
      description={description}
      action={action}
    />
  );
}
