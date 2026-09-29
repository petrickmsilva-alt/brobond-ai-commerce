import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { AuthCardShell } from "@/components/auth/auth-card-shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_AUTHENTICATED_REDIRECT } from "@/lib/auth-routes";
import { passwordResetService } from "@/modules/auth/password-reset.service";

export const metadata: Metadata = {
  title: "Nova senha",
};

/**
 * "Nova senha" — step 3 of §6.
 *
 * The token is validated on the SERVER before the form is rendered, so an
 * expired or already-used link shows a clear explanation immediately instead
 * of letting the user type a new password and only then fail. The action
 * re-validates on submit, which covers a page left open past the 30-minute TTL.
 *
 * SECURITY: an invalid token produces one generic screen. We never
 * distinguish "not found" from "expired" from "already used" here, so the
 * page cannot be used to probe which tokens exist.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (user) redirect(DEFAULT_AUTHENTICATED_REDIRECT);

  const params = await searchParams;
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = typeof raw === "string" ? raw.trim() : "";

  const valid = token ? await passwordResetService.isValid(token) : false;

  if (!valid) {
    return (
      <AuthCardShell
        title="Link inválido ou expirado"
        description="Este link de recuperação não é mais válido. Links expiram 30 minutos após serem gerados e só podem ser usados uma vez."
      >
        <div className="flex flex-col items-center gap-5 py-2 text-center">
          <span
            aria-hidden
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/8 bg-gradient-to-br from-brand-500/18 to-accent-500/10 text-brand-300"
          >
            <KeyRound className="h-7 w-7" />
          </span>
          <Link href="/forgot-password" className="w-full">
            <Button size="lg" className="w-full">
              Solicitar um novo link
            </Button>
          </Link>
          <Link
            href="/login"
            className="text-xs font-medium text-white/45 transition-colors hover:text-white"
          >
            Voltar para o login
          </Link>
        </div>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell
      title="Defina sua nova senha"
      description="Escolha uma senha forte que você ainda não usou em outros serviços."
    >
      <ResetPasswordForm token={token} />
    </AuthCardShell>
  );
}
