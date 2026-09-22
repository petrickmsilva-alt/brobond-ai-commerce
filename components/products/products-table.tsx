"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Package } from "lucide-react";
import type { ProductListItemDTO } from "@/modules/commerce/products/dto/product.dto";
import { formatCurrency, cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProductStatusBadge } from "./product-status-badge";
import { MarginBadge } from "./margin-badge";
import { DeleteProductButton } from "./delete-product-button";

interface ProductsTableProps {
  items: ProductListItemDTO[];
  /** RBAC resolved server-side: MANAGER+ can edit. */
  canEdit: boolean;
  /** RBAC resolved server-side: only ADMIN can delete. */
  canDelete: boolean;
}

function SortableHead({ column, label }: { column: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeSort = searchParams.get("sort") ?? "createdAt";
  const activeOrder = searchParams.get("order") ?? "desc";
  const isActive = activeSort === column;

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", column);
    params.set("order", isActive && activeOrder === "desc" ? "asc" : "desc");
    params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-white/70",
        isActive ? "text-white/80" : "text-white/40",
      )}
    >
      {label}
      {isActive ? (
        activeOrder === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUp className="h-3 w-3" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

export function ProductsTable({ items, canEdit, canDelete }: ProductsTableProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <Package className="h-10 w-10 text-white/20" />
        <p className="text-sm text-white/50">Nenhum produto encontrado.</p>
        <p className="text-xs text-white/30">
          Ajuste os filtros ou cadastre um novo produto para começar.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>
            <SortableHead column="name" label="Produto" />
          </TableHead>
          <TableHead>SKU</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">
            <SortableHead column="priceCents" label="Preço" />
          </TableHead>
          <TableHead className="text-right">Custo</TableHead>
          <TableHead className="text-right">
            <SortableHead column="marginBps" label="Margem" />
          </TableHead>
          <TableHead className="text-right">
            <SortableHead column="stockQuantity" label="Estoque" />
          </TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((product) => (
          <TableRow key={product.id}>
            <TableCell>
              <Link
                href={`/dashboard/products/${product.id}`}
                className="group flex items-center gap-3"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-surface-700 bg-surface-800">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Package className="h-4 w-4 text-white/30" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white group-hover:text-brand-300">
                    {product.name}
                  </p>
                  <p className="truncate text-xs text-white/30">
                    /{product.slug}
                    {product.variantCount > 0 && ` · ${product.variantCount} variação(ões)`}
                  </p>
                </div>
              </Link>
            </TableCell>
            <TableCell className="text-xs text-white/50">{product.sku ?? "—"}</TableCell>
            <TableCell>
              <ProductStatusBadge status={product.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatCurrency(product.priceCents, product.currency)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-white/50">
              {product.currentCostCents > 0
                ? formatCurrency(product.currentCostCents, product.currency)
                : "—"}
            </TableCell>
            <TableCell className="text-right">
              <MarginBadge bps={product.marginBps} />
            </TableCell>
            <TableCell
              className={cn(
                "text-right tabular-nums",
                product.stockQuantity === 0 && "text-red-300",
              )}
            >
              {product.stockQuantity}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex items-center justify-end gap-1">
                {canEdit ? (
                  <Link
                    href={`/dashboard/products/${product.id}`}
                    className="rounded-md px-2 py-1 text-xs text-white/60 transition-colors hover:bg-surface-700 hover:text-white"
                  >
                    Editar
                  </Link>
                ) : (
                  <Link
                    href={`/dashboard/products/${product.id}`}
                    className="rounded-md px-2 py-1 text-xs text-white/60 transition-colors hover:bg-surface-700 hover:text-white"
                  >
                    Ver
                  </Link>
                )}
                {canDelete && <DeleteProductButton productId={product.id} name={product.name} />}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
