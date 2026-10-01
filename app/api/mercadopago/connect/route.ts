import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthorizationError } from "@/lib/rbac";
import { requireAdmin } from "@/lib/session";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { mercadoPagoConnectSchema } from "@/modules/marketplace/core/connector.validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json(
    { ok: false, error, ...(fieldErrors ? { fieldErrors } : {}) },
    { status },
  );
}

/**
 * Mercado Pago connect route (PR012) — receives the seller account's
 * production credentials (Access Token + Public Key), validates the token
 * against the official `/users/me` endpoint and persists both encrypted
 * (AES-256-GCM) on the unified Connector model for checkout billing.
 *
 * RBAC: ADMIN only. The tenant always comes from the session — never from
 * the payload. No credential material is ever returned: the response
 * carries only the masked public-key preview.
 */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "Payload JSON inválido.");
    }

    const parsed = mercadoPagoConnectSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        422,
        "Credenciais inválidas. Revise os campos destacados.",
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
    }

    const connector = await marketplaceService.connectMercadoPago(organizationId, parsed.data);
    return NextResponse.json({
      ok: true,
      data: {
        provider: connector.provider,
        status: connector.status,
        shopId: connector.shopId,
        shopName: connector.shopName,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return jsonError(403, "Você não tem permissão para executar esta ação.");
    }
    if (error instanceof z.ZodError) {
      return jsonError(422, "Credenciais inválidas.");
    }
    console.error(
      "[mercadopago.connect]",
      error instanceof Error ? error.message : "connect failed",
    );
    return jsonError(
      502,
      error instanceof Error && error.name === "ProviderApiError"
        ? error.message
        : "Não foi possível validar as credenciais do Mercado Pago.",
    );
  }
}
