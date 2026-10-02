import { NextResponse } from "next/server";
import { resolveRedirectBaseUrl } from "@/lib/app-url";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { nuvemshopCallbackSchema } from "@/modules/marketplace/core/connector.validator";
import { connectorProviderPath } from "@/modules/marketplace/core/providers";
import { ConnectorOAuthStateError } from "@/modules/marketplace/core/oauth-state.service";
import { ConnectorConfigError } from "@/modules/marketplace/core/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DASHBOARD_PATH = connectorProviderPath("NUVEMSHOP");
type CallbackReason = "denied" | "invalid_request" | "state" | "config" | "exchange";

function redirectToDashboard(
  request: Request,
  result: "connected" | "error",
  reason?: CallbackReason,
) {
  const url = new URL(`${resolveRedirectBaseUrl(request)}${DASHBOARD_PATH}`);
  url.searchParams.set("oauth", result);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

function reasonOf(error: unknown): CallbackReason {
  if (error instanceof ConnectorOAuthStateError) return "state";
  if (error instanceof ConnectorConfigError) return "config";
  return "exchange";
}

/**
 * Nuvemshop OAuth callback.
 *
 * The single-use state determines the workspace. The token service reads and
 * replays NUVEMSHOP_REDIRECT_URI from the server environment; no request URL,
 * Host or forwarded header can influence the OAuth code exchange.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return redirectToDashboard(
      request,
      "error",
      providerError === "access_denied" ? "denied" : "invalid_request",
    );
  }

  const parsed = nuvemshopCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error", "invalid_request");

  try {
    await marketplaceService.handleNuvemshopCallback(parsed.data);
    return redirectToDashboard(request, "connected");
  } catch (error) {
    console.error("[nuvemshop.oauth.callback]", {
      reason: reasonOf(error),
      message: error instanceof Error ? error.message : "exchange failed",
    });
    return redirectToDashboard(request, "error", reasonOf(error));
  }
}
