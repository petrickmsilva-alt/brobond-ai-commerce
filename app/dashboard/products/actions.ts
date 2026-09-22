"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin, requireManager } from "@/lib/session";
import type { ActionResult } from "@/modules/commerce/products/dto";
import {
  productService,
  ProductNotFoundError,
} from "@/modules/commerce/products/services/product.service";
import { productMediaService } from "@/modules/commerce/products/services/product-media.service";
import { productVariantService } from "@/modules/commerce/products/services/product-variant.service";
import { productCostService } from "@/modules/commerce/products/services/product-cost.service";
import { productMetricService } from "@/modules/commerce/products/services/product-metric.service";
import {
  createProductSchema,
  productCostSchema,
  productMediaSchema,
  productMetricSchema,
  productVariantSchema,
  updateProductSchema,
  updateProductVariantSchema,
} from "@/modules/commerce/products/validators/product.schema";

/**
 * Product server actions — the ONLY write path from the UI to the products
 * module.
 *
 * RBAC (enforced server-side on every action):
 *   ADMIN   → create / edit / delete
 *   MANAGER → edit
 *   MEMBER  → read-only (no actions available)
 *
 * TENANT: `organizationId` always comes from the authenticated session
 * (`requireAdmin`/`requireManager` return a guaranteed tenant) and is passed
 * as the first argument of every service call. It is NEVER accepted from
 * the client.
 */

const PRODUCTS_PATH = "/dashboard/products";

function fail(error: unknown): ActionResult<never> {
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Dados inválidos. Revise os campos destacados.",
      fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Você não tem permissão para executar esta ação." };
  }
  if (error instanceof ProductNotFoundError) {
    return { ok: false, error: error.message };
  }
  // Unique-constraint friendly message (tenant-scoped SKU/slug collision).
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  ) {
    return { ok: false, error: "Já existe um registro com este SKU ou slug." };
  }
  console.error("[products.actions]", error);
  return { ok: false, error: "Erro inesperado. Tente novamente." };
}

// ------------------------------------------------------------------
// Product CRUD
// ------------------------------------------------------------------

export async function createProductAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: criar
    const data = createProductSchema.parse(input);
    const product = await productService.create(organizationId, data);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: { id: product.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProductAction(
  id: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager(); // MANAGER+: editar
    const data = updateProductSchema.parse(input);
    const product = await productService.update(organizationId, id, data);
    revalidatePath(PRODUCTS_PATH);
    revalidatePath(`${PRODUCTS_PATH}/${id}`);
    return { ok: true, data: { id: product.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProductAction(id: string): Promise<ActionResult> {
  try {
    const { organizationId } = await requireAdmin(); // ADMIN: excluir
    await productService.delete(organizationId, id);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------
// ProductMedia
// ------------------------------------------------------------------

export async function addProductMediaAction(
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager();
    const data = productMediaSchema.parse(input);
    const media = await productMediaService.add(organizationId, productId, data);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    return { ok: true, data: { id: media.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function setPrimaryMediaAction(
  productId: string,
  mediaId: string,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    await productMediaService.setPrimary(organizationId, mediaId);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function removeProductMediaAction(
  productId: string,
  mediaId: string,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    await productMediaService.remove(organizationId, mediaId);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------
// ProductVariant
// ------------------------------------------------------------------

export async function addProductVariantAction(
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager();
    const data = productVariantSchema.parse(input);
    const variant = await productVariantService.add(organizationId, productId, data);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: { id: variant.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function updateProductVariantAction(
  productId: string,
  variantId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    const data = updateProductVariantSchema.parse(input);
    await productVariantService.update(organizationId, variantId, data);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

export async function removeProductVariantAction(
  productId: string,
  variantId: string,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    await productVariantService.remove(organizationId, variantId);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------
// ProductCost — every mutation recalculates the margin automatically
// ------------------------------------------------------------------

export async function addProductCostAction(
  productId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { organizationId } = await requireManager();
    const data = productCostSchema.parse(input);
    const cost = await productCostService.add(organizationId, productId, data);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: { id: cost.id } };
  } catch (error) {
    return fail(error);
  }
}

export async function removeProductCostAction(
  productId: string,
  costId: string,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    await productCostService.remove(organizationId, costId);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    revalidatePath(PRODUCTS_PATH);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}

// ------------------------------------------------------------------
// ProductMetric
// ------------------------------------------------------------------

export async function recordProductMetricAction(
  productId: string,
  input: unknown,
): Promise<ActionResult> {
  try {
    const { organizationId } = await requireManager();
    const data = productMetricSchema.parse(input);
    await productMetricService.record(organizationId, productId, data);
    revalidatePath(`${PRODUCTS_PATH}/${productId}`);
    return { ok: true, data: undefined };
  } catch (error) {
    return fail(error);
  }
}
