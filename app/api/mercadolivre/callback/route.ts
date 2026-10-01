import { NextResponse } from "next/server";
import { resolveRedirectBaseUrl } from "@/lib/app-url";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { mercadoLivreCallbackSchema } from "@/modules/marketplace/core/connector.validator";
import { connectorProviderPath } from "@/modules/marketplace/core/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the seller lands once Meli hands control back to us — the isolated
 * Mercado Livre connector screen (PR014), not the stacked hub list.
 */
const DASHBOARD_PATH = connectorProviderPath("MERCADOLIVRE");

/**
 * Final hop of the OAuth dance — a navigation the *browser* performs, so the
 * URL must be the deployment's public address.
 *
 * This used to be `new URL(DASHBOARD_PATH, request.url)`. Behind Render's
 * proxy `request.url` is the address Next.js is bound to (the wildcard
 * `0.0.0.0:10000`), so a successful connection redirected to
 * `http://0.0.0.0/dashboard/connectors?oauth=connected` and Chrome refused it
 * with ERR_ADDRESS_INVALID. `resolveRedirectBaseUrl()` builds the absolute
 * address from `APP_URL` / `NEXTAUTH_URL` instead, falling back to the
 * forwarded host and only then to the request origin (see `lib/app-url.ts`).
 */
function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL(`${resolveRedirectBaseUrl(request)}${DASHBOARD_PATH}`);
  url.searchParams.set("oauth", result);
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
