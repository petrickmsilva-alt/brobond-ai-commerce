import { NextResponse } from "next/server";
import { deliveryOAuthCallbackSchema } from "@/modules/delivery/validators";
import { InstagramConnector } from "@/modules/connectors/instagram/instagram.connector";

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
    // The connector completes both stores: DeliveryAccount receives the
    // page-scoped token encrypted for messaging and the unified Connector
    // receives an AES-256-GCM copy protected by CONNECTOR_ENCRYPTION_KEY.
    await new InstagramConnector().exchangeAuthorizationCode(parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error(
      "[instagram.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
