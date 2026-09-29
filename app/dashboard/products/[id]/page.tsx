import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArrowLeft, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductForm } from "@/components/products/product-form";
import { ProductStatusBadge } from "@/components/products/product-status-badge";
import { MarginBadge } from "@/components/products/margin-badge";
import { ProductCostPanel } from "@/components/products/product-cost-panel";
import { ProductVariantPanel } from "@/components/products/product-variant-panel";
import { ProductMediaPanel } from "@/components/products/product-media-panel";
import { DeleteProductButton } from "@/components/products/delete-product-button";
import { requireOrganization, requireUser } from "@/lib/session";
import { hasRole, isAdmin } from "@/lib/rbac";
import { formatCurrency } from "@/lib/utils";
import { productService } from "@/modules/commerce/products/services/product.service";

export const metadata: Metadata = {
  title: "Produto",
};

/**
 * Product detail — edit form (MANAGER+), media, variants, cost history with
 * automatic margin recalculation, and recent metrics. MEMBER sees a
 * read-only summary.
 */
export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const organizationId = await requireOrganization();
  const { id } = await params;

  const product = await productService.getById(organizationId, id);
  if (!product) notFound();

  const canEdit = hasRole(user.role, UserRole.MANAGER);
  const canDelete = isAdmin(user.role);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard/products"
          className="inline-flex items-center gap-1.5 text-xs text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar para produtos
        </Link>
      </div>

      <PageHeader
        title={product.name}
        description={`/${product.slug}${product.sku ? ` · ${product.sku}` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="brand" size="sm" className="inline-flex items-center gap-1.5">
              <Sparkles className="h-3 w-3" />
              Product detail
            </Badge>
            {canDelete ? (
              <DeleteProductButton
                productId={product.id}
                name={product.name}
                redirectTo="/dashboard/products"
              />
            ) : undefined}
          </div>
        }
      />

      <Card className="mb-6 border-white/8 bg-surface-850/80" variant="glass">
        <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">
              Resumo do produto
            </p>
            <h3 className="mt-1 text-base font-semibold text-white">
              {formatCurrency(product.priceCents, product.currency)} · {product.stockQuantity} unidades
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
            <ProductStatusBadge status={product.status} />
            <MarginBadge bps={product.marginBps} />
            <Badge tone="neutral" size="sm">
              custo {product.currentCostCents > 0 ? formatCurrency(product.currentCostCents, product.currency) : "—"}
            </Badge>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{canEdit ? "Editar produto" : "Detalhes do produto"}</CardTitle>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <ProductForm
                  initial={{
                    id: product.id,
                    name: product.name,
                    slug: product.slug,
                    description: product.description,
                    sku: product.sku,
                    priceCents: product.priceCents,
                    status: product.status,
                    stockQuantity: product.stockQuantity,
                    imageUrl: product.imageUrl,
                  }}
                />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-white/40">Descrição</dt>
                    <dd className="mt-1 text-white/80">{product.description ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">Moeda</dt>
                    <dd className="mt-1 text-white/80">{product.currency}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">Criado em</dt>
                    <dd className="mt-1 text-white/80">
                      {product.createdAt.toLocaleDateString("pt-BR")}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-white/40">Atualizado em</dt>
                    <dd className="mt-1 text-white/80">
                      {product.updatedAt.toLocaleDateString("pt-BR")}
                    </dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Mídia</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductMediaPanel
                productId={product.id}
                canEdit={canEdit}
                media={product.media.map((item) => ({
                  id: item.id,
                  url: item.url,
                  altText: item.altText,
                  isPrimary: item.isPrimary,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Variações</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductVariantPanel
                productId={product.id}
                canEdit={canEdit}
                variants={product.variants.map((variant) => ({
                  id: variant.id,
                  name: variant.name,
                  sku: variant.sku,
                  priceCents: variant.priceCents,
                  stockQuantity: variant.stockQuantity,
                  isActive: variant.isActive,
                }))}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custos & Margem</CardTitle>
            </CardHeader>
            <CardContent>
              <ProductCostPanel
                productId={product.id}
                canEdit={canEdit}
                costs={product.costs.map((cost) => ({
                  id: cost.id,
                  unitCents: cost.unitCents,
                  freightCents: cost.freightCents,
                  packagingCents: cost.packagingCents,
                  feesCents: cost.feesCents,
                  otherCents: cost.otherCents,
                  note: cost.note,
                  effectiveFrom: cost.effectiveFrom.toISOString(),
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
