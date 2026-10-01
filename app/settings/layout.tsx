import { AppShell } from "@/components/layout/app-shell";
import { getShellContext } from "@/lib/shell-context";

/** Settings layout — same authenticated shell as /dashboard (PR010.1). */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { user, tiktokStatus } = await getShellContext();

  return (
    <AppShell user={user} tiktokStatus={tiktokStatus}>
      {children}
    </AppShell>
  );
}
