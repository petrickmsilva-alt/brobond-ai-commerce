import "server-only";

import { cookies } from "next/headers";
import type { ConnectorOAuthStateCookie } from "@/modules/marketplace/core/connector.service";

/**
 * Plant the double-submit CSRF cookie for a connector OAuth round-trip.
 *
 * WHY THIS LIVES IN ITS OWN MODULE
 * --------------------------------
 * `cookies()` is only writable from a Server Action or a Route Handler, and
 * importing `next/headers` poisons any module that unit tests exercise in a
 * plain Node environment. `marketplaceService.startOAuth()` therefore RETURNS
 * the state as data and this helper — imported exclusively by the action
 * layer — performs the single side effect.
 *
 * `sameSite: "lax"` is required, not cosmetic: the provider sends the user
 * back with a cross-site top-level GET, which is exactly the navigation Lax
 * still attaches cookies to (Strict would drop it and every callback would
 * fail `state_mismatch`).
 */
export async function plantOAuthStateCookie(cookie: ConnectorOAuthStateCookie): Promise<void> {
  const store = await cookies();
  store.set({
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: cookie.maxAge,
  });
}
