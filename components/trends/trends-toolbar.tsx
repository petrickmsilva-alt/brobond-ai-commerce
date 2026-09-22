"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TREND_CATEGORIES } from "@/modules/trends/interfaces/trend.interface";

/**
 * Trends dashboard filter toolbar — everything is URL-state (search params),
 * so the listing is shareable, back-button friendly and rendered on the
 * server.
 *
 * Filters: busca (keyword) · categoria. Every change resets the page to 1.
 */
export function TrendsToolbar() {
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

  const hasFilters = searchParams.get("search") || searchParams.get("category");

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por keyword…"
          className="pl-9"
          aria-label="Buscar tendências"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={searchParams.get("category") ?? ""}
          onChange={(event) => apply({ category: event.target.value || null })}
          className="w-40"
          aria-label="Filtrar por categoria"
        >
          <option value="">Categoria: todas</option>
          {TREND_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
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
