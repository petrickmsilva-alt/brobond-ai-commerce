import { NextResponse } from "next/server";
import { connectorOAuthStateService } from "@/modules/marketplace/core/oauth-state.service";
import { marketplaceRepository } from "@/modules/marketplace/core/connector.repository";
import { encryptConnectorSecret } from "@/modules/marketplace/core/crypto.service";
import { exchangeNuvemshopCode } from "@/modules/connectors/nuvemshop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state)
    return NextResponse.redirect(
      new URL("/dashboard/connectors/nuvemshop?oauth=error&reason=invalid_request", url),
    );
  try {
    const { organizationId } = await connectorOAuthStateService.consume(state, "NUVEMSHOP");
    const token = await exchangeNuvemshopCode(code);
    await marketplaceRepository.upsertConnection(organizationId, "NUVEMSHOP", {
      status: "CONNECTED",
      accessToken: encryptConnectorSecret(token.accessToken),
      shopId: token.userId,
      shopName: "Nuvemshop",
      metadata: { tokenType: token.tokenType, scope: token.scope },
    });
    return NextResponse.redirect(new URL("/dashboard/connectors/nuvemshop?oauth=connected", url));
  } catch (error) {
    console.error("[nuvemshop.oauth]", error);
    return NextResponse.redirect(
      new URL("/dashboard/connectors/nuvemshop?oauth=error&reason=exchange", url),
    );
  }
}
