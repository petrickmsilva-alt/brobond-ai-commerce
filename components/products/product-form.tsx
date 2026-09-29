"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { createProductAction, updateProductAction } from "@/app/dashboard/products/actions";

/**
 * Product create/edit form.
 *
 * The form works in human units (preço em reais) and converts to integer
 * cents before hitting the server action, which re-validates with the module
 * Zod schema (client validation is UX only — the server is authoritative).
 */
const formSchema = z.object({
  name: z.string().trim().min(2, "O nome deve ter ao menos 2 caracteres.").max(160),
  slug: z
    .string()
    .trim()
    .max(80)
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use apenas letras minúsculas, números e hífens.")
    .optional(),
  description: z.string().trim().max(5000).optional(),
  sku: z.string().trim().max(64).optional(),
  price: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, "Informe um preço válido (ex.: 149,90)."),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  stockQuantity: z.coerce.number().int("Use um número inteiro.").min(0, "Não pode ser negativo."),
  imageUrl: z.string().trim().url("Informe uma URL válida.").optional().or(z.literal("")),
});

type FormValues = z.infer<typeof formSchema>;

export interface ProductFormInitial {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sku: string | null;
  priceCents: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  stockQuantity: number;
  imageUrl: string | null;
}

function toCents(price: string): number {
  return Math.round(Number.parseFloat(price.replace(",", ".")) * 100);
}

export function ProductForm({ initial }: { initial?: ProductFormInitial }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initial
      ? {
          name: initial.name,
          slug: initial.slug,
          description: initial.description ?? "",
          sku: initial.sku ?? "",
          price: (initial.priceCents / 100).toFixed(2).replace(".", ","),
          status: initial.status,
          stockQuantity: initial.stockQuantity,
          imageUrl: initial.imageUrl ?? "",
        }
      : {
          name: "",
          slug: "",
          description: "",
          sku: "",
          price: "0,00",
          status: "DRAFT",
          stockQuantity: 0,
          imageUrl: "",
        },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setFormError(null);

    const payload = {
      name: values.name,
      slug: values.slug || undefined,
      description: values.description || undefined,
      sku: values.sku || undefined,
      priceCents: toCents(values.price),
      status: values.status,
      stockQuantity: values.stockQuantity,
      imageUrl: values.imageUrl || undefined,
    };

    const result = initial
      ? await updateProductAction(initial.id, payload)
      : await createProductAction(payload);

    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }

    router.push(`/dashboard/products/${result.data.id}`);
    router.refresh();
  }

  const fieldError = (key: keyof FormValues) =>
    errors[key] ? <p className="text-xs text-red-300">{errors[key]?.message}</p> : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="name" className="text-xs font-medium text-white/60">
            Nome *
          </label>
          <Input id="name" placeholder="Ex.: Moletom Premium" {...register("name")} />
          {fieldError("name")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="slug" className="text-xs font-medium text-white/60">
            Slug <span className="text-white/30">(automático se vazio)</span>
          </label>
          <Input id="slug" placeholder="moletom-premium" {...register("slug")} />
          {fieldError("slug")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="sku" className="text-xs font-medium text-white/60">
            SKU
          </label>
          <Input id="sku" placeholder="BB-0001" {...register("sku")} />
          {fieldError("sku")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="price" className="text-xs font-medium text-white/60">
            Preço (R$) *
          </label>
          <Input id="price" inputMode="decimal" placeholder="149,90" {...register("price")} />
          {fieldError("price")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="stockQuantity" className="text-xs font-medium text-white/60">
            Estoque
          </label>
          <Input id="stockQuantity" type="number" min={0} {...register("stockQuantity")} />
          {fieldError("stockQuantity")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="status" className="text-xs font-medium text-white/60">
            Status
          </label>
          <Select id="status" {...register("status")}>
            <option value="DRAFT">Rascunho</option>
            <option value="ACTIVE">Ativo</option>
            <option value="ARCHIVED">Arquivado</option>
          </Select>
          {fieldError("status")}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="imageUrl" className="text-xs font-medium text-white/60">
            Imagem de capa (URL)
          </label>
          <Input id="imageUrl" placeholder="https://…" {...register("imageUrl")} />
          {fieldError("imageUrl")}
          <p className="text-[11px] text-white/30">
            Upload binário chega em um PR futuro — a interface de storage já está preparada.
          </p>
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <label htmlFor="description" className="text-xs font-medium text-white/60">
            Descrição
          </label>
          <textarea
            id="description"
            rows={4}
            className="flex w-full rounded-lg border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-white placeholder:text-white/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:border-brand-500"
            placeholder="Detalhes do produto…"
            {...register("description")}
          />
          {fieldError("description")}
        </div>
      </div>

      {formError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {formError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {initial ? "Salvar alterações" : "Criar produto"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
