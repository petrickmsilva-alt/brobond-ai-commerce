"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilterX, type LucideIcon } from "lucide-react";
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
 */

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
  /** Icon for the "no data at all" case. */
  icon?: LucideIcon;
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
  icon,
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

  return (
    <EmptyState
      size="md"
      bordered={false}
      icon={icon}
      title={title}
      description={description}
      action={action}
    />
  );
}
