import { NextResponse } from "next/server";
import { exchangeToken } from "@/modules/delivery/whatsapp/auth.service";
import { deliveryOAuthCallbackSchema } from "@/modules/delivery/validators";

export const runtime = "nodejs";

function redirectToDashboard(request: Request, result: "connected" | "error") {
  const url = new URL("/dashboard/delivery", request.url);
  url.searchParams.set("oauth", result);
  url.searchParams.set("channel", "WHATSAPP");
  return NextResponse.redirect(url);
}

/**
 * Public WhatsApp Business OAuth callback (Embedded Signup return). The
 * opaque one-time state — and only it — determines the tenant. No OAuth
 * error detail ever reaches the browser redirect.
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
    await exchangeToken(parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error(
      "[whatsapp.oauth.callback]",
      error instanceof Error ? error.message : "exchange failed",
    );
    return redirectToDashboard(request, "error");
  }
}
