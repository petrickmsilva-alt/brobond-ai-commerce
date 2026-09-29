import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { Package, Plus, Boxes, Percent, CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { ProductsToolbar } from "@/components/products/products-toolbar";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsPagination } from "@/components/products/products-pagination";
import { requireOrganization, requireUser } from "@/lib/session";
import { hasRole, isAdmin } from "@/lib/rbac";
import { formatMarginBps } from "@/modules/commerce/products/pricing/margin";
import { productService } from "@/modules/commerce/products/services/product.service";
import { productListQuerySchema } from "@/modules/commerce/products/validators/product.schema";

export const metadata: Metadata = {
  title: "Produtos",
};

/**
 * Products dashboard — paginated, filterable, searchable, sortable listing.
 *
 * RBAC (UI affordances; the server actions re-check on every mutation):
 *   ADMIN   → criar / editar / excluir
 *   MANAGER → editar
 *   MEMBER  → somente leitura
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const organizationId = await requireOrganization();

  const raw = await searchParams;
  const query = productListQuerySchema.parse(
    Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
    ),
  );

  const [pageData, stats] = await Promise.all([
    productService.page(organizationId, query),
    productService.stats(organizationId),
  ]);

  const canEdit = hasRole(user.role, UserRole.MANAGER);
  const canCreate = isAdmin(user.role);
  const canDelete = isAdmin(user.role);

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo com preço, custo, margem e estoque — escopo do seu workspace."
        actions={
          canCreate ? (
            <Link href="/dashboard/products/new">
              <Button>
                <Plus className="h-4 w-4" />
                Novo produto
              </Button>
            </Link>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total de produtos" value={String(stats.total)} icon={Package} />
        <KpiCard label="Ativos" value={String(stats.active)} icon={CircleCheck} />
        <KpiCard label="Estoque total" value={String(stats.totalStock)} icon={Boxes} />
        <KpiCard
          label="Margem média"
          value={stats.total > 0 ? formatMarginBps(stats.avgMarginBps) : "—"}
          icon={Percent}
        />
      </div>

      <Card className="mb-4 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-4 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Visão do catálogo
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {stats.total} produtos em operação
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
              {stats.active} ativos
            </span>
            <span className="rounded-full border border-brand-400/20 bg-brand-500/10 px-2.5 py-1 text-brand-200">
              {stats.totalStock} unidades em estoque
            </span>
          </div>
        </div>
        <div className="px-4 py-4 lg:px-6">
          <Suspense>
            <ProductsToolbar />
          </Suspense>
        </div>
      </Card>

      <Card className="overflow-hidden" variant="default">
        <Suspense>
          <ProductsTable items={pageData.items} canEdit={canEdit} canDelete={canDelete} />
          <ProductsPagination
            page={pageData.page}
            totalPages={pageData.totalPages}
            total={pageData.total}
            pageSize={pageData.pageSize}
          />
        </Suspense>
      </Card>
    </>
  );
}
