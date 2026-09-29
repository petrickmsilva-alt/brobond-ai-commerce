"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/**
 * Dashboard filter toolbar — everything is URL-state (search params), so the
 * listing is shareable, back-button friendly and rendered on the server.
 *
 * Filters: busca (nome/slug/SKU) · status · margem mínima · preço máximo ·
 * estoque. Every change resets the page to 1.
 */
export function ProductsToolbar() {
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
    searchParams.get("status") ||
    searchParams.get("minMarginBps") ||
    searchParams.get("maxPriceCents") ||
    searchParams.get("inStock");

  return (
    <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nome, slug ou SKU…"
          className="pl-9"
          aria-label="Buscar produtos"
        />
        {isPending && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-white/40" />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={searchParams.get("status") ?? ""}
          onChange={(event) => apply({ status: event.target.value || null })}
          className="w-36"
          aria-label="Filtrar por status"
        >
          <option value="">Status: todos</option>
          <option value="DRAFT">Rascunho</option>
          <option value="ACTIVE">Ativo</option>
          <option value="ARCHIVED">Arquivado</option>
        </Select>

        <Select
          value={searchParams.get("minMarginBps") ?? ""}
          onChange={(event) => apply({ minMarginBps: event.target.value || null })}
          className="w-40"
          aria-label="Filtrar por margem mínima"
        >
          <option value="">Margem: qualquer</option>
          <option value="2000">≥ 20%</option>
          <option value="3000">≥ 30%</option>
          <option value="5000">≥ 50%</option>
          <option value="7000">≥ 70%</option>
        </Select>

        <Select
          value={searchParams.get("maxPriceCents") ?? ""}
          onChange={(event) => apply({ maxPriceCents: event.target.value || null })}
          className="w-40"
          aria-label="Filtrar por preço máximo"
        >
          <option value="">Preço: qualquer</option>
          <option value="5000">até R$ 50</option>
          <option value="10000">até R$ 100</option>
          <option value="20000">até R$ 200</option>
          <option value="50000">até R$ 500</option>
        </Select>

        <Select
          value={searchParams.get("inStock") ?? ""}
          onChange={(event) => apply({ inStock: event.target.value || null })}
          className="w-40"
          aria-label="Filtrar por estoque"
        >
          <option value="">Estoque: todos</option>
          <option value="true">Em estoque</option>
          <option value="false">Sem estoque</option>
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
