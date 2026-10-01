import "server-only";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import type { UserMenuProps } from "@/components/layout/user-menu";
import type { ConnectionState } from "@/components/layout/connection-status";

/**
 * App-shell context resolver.
 *
 * Builds the small, non-secret payload the authenticated chrome needs
 * (display name, email, role and integration health) from the authenticated
 * session. The previous workspace selector was removed from the personal hub,
 * so this resolver no longer fetches or serializes workspace presentation data.
 *
 * SECURITY CONTRACT
 * -----------------
 * This module is `server-only` and every field it returns is safe to serialize
 * into a Client Component:
 *   - no `passwordHash`, token, encrypted column or environment value;
 *   - the TikTok health check `count`s rows by status — it never selects
 *     `accessToken`, `refreshToken`, `shopId` or any credential;
 *   - all queries are scoped to the caller's `organizationId`, which comes
 *     from the session and never from a client-supplied value.
 */

export interface ShellContext {
  user: UserMenuProps;
  tiktokStatus: ConnectionState;
}

/** Friendly fallback when the account has no display name. */
function displayName(name: string | null, email: string | null): string {
  if (name?.trim()) return name.trim();
  const local = email?.split("@")[0];
  return local?.trim() || "Usuário";
}

export async function getShellContext(): Promise<ShellContext> {
  const user = await requireUser();
  const organizationId = user.organizationId;

  const [tiktokConnected, tiktokTotal] = await Promise.all([
    organizationId
      ? prisma.tikTokAccount.count({ where: { organizationId, status: "CONNECTED" } })
      : Promise.resolve(0),
    organizationId ? prisma.tikTokAccount.count({ where: { organizationId } }) : Promise.resolve(0),
  ]);

  const tiktokStatus: ConnectionState =
    tiktokConnected > 0 ? "connected" : tiktokTotal > 0 ? "error" : "disconnected";

  return {
    user: {
      name: displayName(user.name, user.email),
      email: user.email ?? "—",
      role: user.role,
      image: user.image,
    },
    tiktokStatus,
  };
}
