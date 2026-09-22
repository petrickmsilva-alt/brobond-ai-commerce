"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  CREATOR_NICHES,
  CREATOR_SOURCES,
  CREATOR_SOURCE_LABELS,
  CREATOR_STATUSES,
  CREATOR_STATUS_LABELS,
} from "@/modules/creators/interfaces/creator.interface";

/**
 * Creators dashboard filter toolbar — everything is URL-state (search
 * params), so the listing is shareable, back-button friendly and rendered
 * on the server.
 *
 * Filters: busca (handle/nome) · nicho · status · origem. Every change
 * resets the page to 1.
 */
export function CreatorsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback(
    (patch: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page"); // any filter change resets pagination
      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  // Debounced search
  useEffect(() => {
    const current = searchParams.get("search") ?? "";
    if (search === current) return;
    debounceRef.current = setTimeout(() => apply({ search }), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, searchParams, apply]);

  const hasFilters =
    searchParams.get("search") ||
    searchParams.get("niche") ||
    searchParams.get("status") ||
    searchParams.get("source");

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por handle ou nome…"
          className="pl-9"
          aria-label="Buscar creators"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={searchParams.get("niche") ?? ""}
          onChange={(event) => apply({ niche: event.target.value || null })}
          className="w-36"
          aria-label="Filtrar por nicho"
        >
          <option value="">Nicho: todos</option>
          {CREATOR_NICHES.map((niche) => (
            <option key={niche} value={niche}>
              {niche}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("status") ?? ""}
          onChange={(event) => apply({ status: event.target.value || null })}
          className="w-44"
          aria-label="Filtrar por status"
        >
          <option value="">Status: todos</option>
          {CREATOR_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CREATOR_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>

        <Select
          value={searchParams.get("source") ?? ""}
          onChange={(event) => apply({ source: event.target.value || null })}
          className="w-36"
          aria-label="Filtrar por origem"
        >
          <option value="">Origem: todas</option>
          {CREATOR_SOURCES.map((source) => (
            <option key={source} value={source}>
              {CREATOR_SOURCE_LABELS[source]}
            </option>
          ))}
        </Select>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              startTransition(() => router.replace(pathname, { scroll: false }));
            }}
          >
            <X className="h-3.5 w-3.5" />
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
