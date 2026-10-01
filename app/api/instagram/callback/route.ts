import { NextResponse } from "next/server";
import { exchangeCode } from "@/modules/delivery/instagram/auth.service";
import { deliveryOAuthCallbackSchema } from "@/modules/delivery/validators";
import { mirrorInstagramConnection } from "@/modules/marketplace/instagram/instagram-bridge.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL("/dashboard/delivery", request.url);
  url.searchParams.set("oauth", result);
  url.searchParams.set("channel", "INSTAGRAM");
  return NextResponse.redirect(url);
}

/**
 * Public Instagram Business OAuth callback. The opaque one-time state — and
 * only it — determines the tenant. No OAuth error detail ever reaches the
 * browser redirect; operators read the server-side audit trail.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return redirectToDashboard(request, "error");

  const parsed = deliveryOAuthCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error");

  try {
    const accounts = await exchangeCode(parsed.data);
    // PR012: mirror the credential into the unified Connector model so the
    // Instagram Shopping card reflects the real state (best-effort — never
    // fails the OAuth redirect).
    if (accounts[0]?.organizationId) {
      await mirrorInstagramConnection(accounts[0].organizationId).catch(() => undefined);
    }
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error(
      "[instagram.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
