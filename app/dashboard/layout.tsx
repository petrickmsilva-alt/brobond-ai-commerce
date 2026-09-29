import { AppShell } from "@/components/layout/app-shell";
import { getShellContext } from "@/lib/shell-context";

/**
 * Authenticated dashboard layout (PR010.1).
 *
 * Resolves the shell's presentation context server-side — display name, role,
 * workspace and integration health — and passes only that non-secret payload
 * into the client shell. No token, credential or environment value crosses the
 * boundary.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, workspace, tiktokStatus } = await getShellContext();

  return (
    <AppShell user={user} workspace={workspace} tiktokStatus={tiktokStatus}>
      {children}
    </AppShell>
  );
}
