import { NextResponse } from "next/server";
import { resolveRedirectBaseUrl, resolveRequestUrl } from "@/lib/app-url";
import { marketplaceService } from "@/modules/marketplace/core/connector.service";
import { ConnectorOAuthStateError } from "@/modules/marketplace/core/oauth-state.service";
import { ConnectorConfigError, MarketplaceError } from "@/modules/marketplace/core/errors";
import { mercadoLivreCallbackSchema } from "@/modules/marketplace/core/connector.validator";
import { connectorProviderPath } from "@/modules/marketplace/core/providers";
import { mercadoLivreRedirectUriCandidates } from "@/modules/marketplace/mercadolivre/mercadolivre.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the seller lands once Meli hands control back to us — the isolated
 * Mercado Livre connector screen (PR014), not the stacked hub list.
 */
const DASHBOARD_PATH = connectorProviderPath("MERCADOLIVRE");

/** Stable failure taxonomy consumed by the connector panel. */
export type MercadoLivreCallbackReason =
  "denied" | "invalid_request" | "state" | "config" | "exchange";

/**
 * OAuth errors returned by Meli are safe to show as text after React escaping.
 * Prefer the commercial explanation, falling back to the protocol error code.
 * Authorization codes, state and credentials are never included.
 */
function mercadoLivreCallbackError(url: URL): {
  code: string;
  detail: string;
  rawResponse: Record<string, string>;
} | null {
  const code = url.searchParams.get("error");
  if (!code) return null;

  const description = url.searchParams.get("error_description");
  const message = url.searchParams.get("message");
  return {
    code,
    detail: description ?? message ?? code,
    // The OAuth callback is a GET and therefore has no response body. Preserve
    // the recognized provider error fields verbatim while excluding
    // `state` and the authorization `code`, which are security material.
    rawResponse: {
      error: code,
      ...(description !== null ? { error_description: description } : {}),
      ...(message !== null ? { message } : {}),
    },
  };
}

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
function redirectToDashboard(
  request: Request,
  result: "connected" | "error",
  reason?: MercadoLivreCallbackReason,
  providerDetail?: string,
) {
  const url = new URL(`${resolveRedirectBaseUrl(request)}${DASHBOARD_PATH}`);
  url.searchParams.set("oauth", result);
  if (reason) url.searchParams.set("reason", reason);
  if (providerDetail) url.searchParams.set("provider_detail", providerDetail);
  return NextResponse.redirect(url);
}

/** Map a thrown exchange failure onto one sanitized reason token. */
function reasonOf(error: unknown): MercadoLivreCallbackReason {
  if (error instanceof ConnectorOAuthStateError) return "state";
  if (error instanceof ConnectorConfigError) return "config";
  return "exchange";
}

/**
 * Mercado Livre OAuth2 callback (Meli API). The opaque one-time state —
 * and only it — determines the tenant (same contract as the PR009 TikTok
 * flow). No OAuth error detail ever reaches the browser redirect.
 *
 * REDIRECT URI (PR016.1): the code exchange must replay the exact
 * `redirect_uri` used on `/authorization`. The request is threaded into the
 * service so the resolution order is `MERCADOLIVRE_REDIRECT_URI` → `APP_URL`
 * → `NEXTAUTH_URL` → this request's own public URL — the last one being
 * where Meli actually delivered the browser, which is what makes a domain
 * divergence recoverable instead of fatal.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const providerError = mercadoLivreCallbackError(url);
  if (providerError) {
    const reason = providerError.code === "access_denied" ? "denied" : "invalid_request";
    console.warn("[mercadolivre.oauth.callback] Mercado Livre rejeitou a autorização", {
      error: providerError.code,
      detail: providerError.detail,
      rawResponse: providerError.rawResponse,
    });
    return redirectToDashboard(
      request,
      "error",
      reason,
      reason === "invalid_request" ? providerError.detail : undefined,
    );
  }

  const parsed = mercadoLivreCallbackSchema.safeParse({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
  });
  if (!parsed.success) return redirectToDashboard(request, "error", "invalid_request");

  try {
    await marketplaceService.handleMercadoLivreCallback(parsed.data, { request });
    return redirectToDashboard(request, "connected");
  } catch (error) {
    // Diagnostics for the operator reading Render's logs: the redirect URIs
    // this deployment presented (never the code, the state or the secret).
    // If none of them is registered in DevCenter, this line says so.
    console.error("[mercadolivre.oauth.callback]", {
      message: error instanceof Error ? error.message : "exchange failed",
      reason: reasonOf(error),
      requiresReauth: error instanceof MarketplaceError ? error.requiresReauth : undefined,
      redirectUriCandidates: mercadoLivreRedirectUriCandidates(request),
      deliveredTo: resolveRequestUrl(request),
    });
    return redirectToDashboard(request, "error", reasonOf(error));
  }
}
