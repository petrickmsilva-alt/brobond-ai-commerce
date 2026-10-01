import { NextResponse } from "next/server";
import { AuthorizationError } from "@/lib/rbac";
import { requireOrganization } from "@/lib/session";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Safe connector-card bootstrap endpoint.
 *
 * It resolves status from the current tenant's Connector rows and applies the
 * server-only Mercado Pago Render fallback. The response contains status,
 * masked previews and synchronization metrics only — never credential values.
 */
export async function GET() {
  try {
    const organizationId = await requireOrganization();
    const connectors = await marketplaceService.listConnectorCards(organizationId);
    const mercadoPago =
      connectors.find((connector) => connector.provider === "MERCADOPAGO") ?? null;

    return NextResponse.json(
      { ok: true, connectors, mercadoPago },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return NextResponse.json(
        { ok: false, error: error.status === 401 ? "unauthorized" : "forbidden" },
        { status: error.status },
      );
    }

    console.error(
      "[connectors.status]",
      error instanceof Error ? error.message : "status resolution failed",
    );
    return NextResponse.json(
      { ok: false, error: "Não foi possível carregar o status dos conectores." },
      { status: 500 },
    );
  }
}
