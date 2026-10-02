import "server-only";

import { ConnectorConfigError } from "@/modules/marketplace/core/errors";

const AUTHORIZE_URL = "https://www.tiendanube.com/apps/authorize";
const TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConnectorConfigError(name, "NUVEMSHOP");
  return value;
}

export function getNuvemshopConfig() {
  return {
    appId: process.env.NUVEMSHOP_APP_ID?.trim() || "44816",
    clientSecret: required("NUVEMSHOP_CLIENT_SECRET"),
    redirectUri: required("NUVEMSHOP_REDIRECT_URI"),
  };
}

export function buildNuvemshopAuthorizationUrl(state: string): string {
  const config = getNuvemshopConfig();
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export interface NuvemshopTokenSet {
  accessToken: string;
  tokenType: string;
  userId: string;
  scope: string | null;
}

export async function exchangeNuvemshopCode(code: string): Promise<NuvemshopTokenSet> {
  const config = getNuvemshopConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_id: config.appId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new Error(`Nuvemshop recusou a troca OAuth (${response.status}).`);
  }
  return {
    accessToken: payload.access_token,
    tokenType: typeof payload.token_type === "string" ? payload.token_type : "bearer",
    userId: String(payload.user_id ?? ""),
    scope: typeof payload.scope === "string" ? payload.scope : null,
  };
}
