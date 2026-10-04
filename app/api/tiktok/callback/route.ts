import { NextResponse } from "next/server";
import { exchangeCode } from "@/modules/connectors/tiktok/auth/oauth.service";
import { tiktokOAuthCallbackSchema } from "@/modules/connectors/tiktok/validators";
import { mirrorTikTokConnection } from "@/modules/marketplace/tiktok/tiktok-bridge.service";

export const runtime = "nodejs";
// OAuth callbacks depend on request query parameters and must never enter the
// production static-generation pass. Login Kit v2 uses the namespaced callback
// route; this legacy Shop endpoint remains dynamic while old registrations are
// retired so it cannot destabilize a build.
export const dynamic = "force-dynamic";

function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL("/dashboard/tiktok", request.url);
  url.searchParams.set("oauth", result);
  return NextResponse.redirect(url);
}

/** Public OAuth callback. The opaque one-time state determines the tenant. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rejected = url.searchParams.get("error");
  if (rejected) return redirectToDashboard(request, "error");

  const parsed = tiktokOAuthCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error");

  try {
    const accounts = await exchangeCode(parsed.data);
    // PR012: mirror the connected seller credential into the unified
    // Connector model so the marketplace card reflects the real state.
    // Mirroring is best-effort and never fails the OAuth redirect.
    if (accounts[0]?.organizationId) {
      await mirrorTikTokConnection(accounts[0].organizationId).catch(() => undefined);
    }
    return redirectToDashboard(request, "connected");
  } catch (error) {
    // Never leak OAuth/provider errors (or any token-adjacent detail) through
    // the browser redirect. Operators can inspect the server-side audit trail.
    console.error(
      "[tiktok.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
