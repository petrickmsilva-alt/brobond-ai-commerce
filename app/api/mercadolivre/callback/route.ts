import { NextResponse } from "next/server";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { mercadoLivreCallbackSchema } from "@/modules/marketplace/core/connector.validator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL("/dashboard/connectors", request.url);
  url.searchParams.set("oauth", result);
  url.searchParams.set("provider", "mercadolivre");
  return NextResponse.redirect(url);
}

/**
 * Mercado Livre OAuth2 callback (Meli API). The opaque one-time state —
 * and only it — determines the tenant (same contract as the PR009 TikTok
 * flow). No OAuth error detail ever reaches the browser redirect.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectToDashboard(request, "error");

  const parsed = mercadoLivreCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error");

  try {
    await marketplaceService.handleMercadoLivreCallback(parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error(
      "[mercadolivre.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
