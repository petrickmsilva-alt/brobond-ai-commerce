import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { shopeeCallbackSchema } from "@/modules/marketplace/core/connector.validator";
import { connectorProviderPath } from "@/modules/marketplace/core/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sellers land on the isolated Shopee connector screen (PR014). */
function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL(connectorProviderPath("SHOPEE"), request.url);
  url.searchParams.set("oauth", result);
  return NextResponse.redirect(url);
}

/**
 * Shopee Open Platform v2 seller-authorization callback.
 *
 * TENANT BINDING: the Shopee redirect does NOT carry a `state` parameter,
 * so the tenant is resolved from the authenticated ADMIN session — the
 * operator clicked "Conectar" inside the dashboard and the session cookie
 * travels with the provider redirect. Unauthenticated hits are rejected.
 *
 * No OAuth/provider error detail ever reaches the browser redirect;
 * operators read the server-side audit trail.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectToDashboard(request, "error");

  try {
    // Session-authenticated tenant binding (replaces the state parameter).
    const { organizationId } = await requireAdmin();

    const parsed = shopeeCallbackSchema.safeParse({
      code: url.searchParams.get("code"),
      shop_id: url.searchParams.get("shop_id"),
    });
    if (!parsed.success) return redirectToDashboard(request, "error");

    await marketplaceService.handleShopeeCallback(organizationId, parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error(
      "[shopee.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
