import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_AUTHENTICATED_REDIRECT } from "@/lib/auth-routes";
import { PASSWORD_RESET_TTL_MINUTES } from "@/lib/tokens";

export const metadata: Metadata = {
  title: "Recuperar senha",
};

/**
 * "Esqueci minha senha" — step 1 of §6 (email → token → nova senha).
 *
 * Replaces the PR010.1 `mailto:suporte@brobond.ai` link, which asked a locked
 * out user to compose an email and wait for a human.
 *
 * An already-authenticated visitor is redirected away: they do not need a
 * recovery link, they need their dashboard.
 */
export default async function ForgotPasswordPage() {
  const user = await getCurrentUser();
  if (user) redirect(DEFAULT_AUTHENTICATED_REDIRECT);

  return (
    <AuthCardShell
      title="Recuperar acesso"
      description={`Informe o email da sua conta e enviaremos um link para criar uma nova senha. O link expira em ${PASSWORD_RESET_TTL_MINUTES} minutos.`}
    >
      <ForgotPasswordForm />
    </AuthCardShell>
  );
}
