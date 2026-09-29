import type { Metadata } from "next";
import { UserRole } from "@prisma/client";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ProductForm } from "@/components/products/product-form";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = {
  title: "Novo produto",
};

/** Create page — ADMIN only (server-enforced, mirrored by the action). */
export default async function NewProductPage() {
  await requireRole(UserRole.ADMIN);

  return (
    <>
      <PageHeader
        title="Novo produto"
        description="O slug é gerado automaticamente a partir do nome — informe um manualmente apenas se necessário."
      />
      <Card className="max-w-3xl">
        <CardContent>
          <ProductForm />
        </CardContent>
      </Card>
    </>
  );
}
