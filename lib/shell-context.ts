import "server-only";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { APP_SHORT_NAME } from "@/lib/constants";
import type { UserMenuProps } from "@/components/layout/user-menu";
import type { WorkspaceOption } from "@/components/layout/workspace-switcher";
import type { ConnectionState } from "@/components/layout/connection-status";

/**
 * App-shell context resolver — PR010.1 (UI only).
 *
 * Builds the small, non-secret payload the authenticated chrome needs
 * (display name, email, role, workspace name, integration health) from the
 * already-authenticated session.
 *
 * SECURITY CONTRACT
 * -----------------
 * This module is `server-only` and every field it returns is safe to serialize
 * into a Client Component:
 *   - no `passwordHash`, no token, no encrypted column, no environment value;
 *   - the TikTok health check `count`s rows by status — it never selects
 *     `accessToken`, `refreshToken`, `shopId` or any credential;
 *   - all queries are scoped to the caller's `organizationId`, which comes
 *     from the session and never from a client-supplied value.
 *
 * It reads no business rule and mutates nothing — it is presentation metadata.
 */

export interface ShellContext {
  user: UserMenuProps;
  workspace: WorkspaceOption;
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

  const [organization, tiktokConnected, tiktokTotal] = await Promise.all([
    organizationId
      ? prisma.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        })
      : Promise.resolve(null),
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
    workspace: {
      id: organizationId ?? "unknown",
      name: organization?.name ?? APP_SHORT_NAME,
      caption: "Workspace",
    },
    tiktokStatus,
  };
}
