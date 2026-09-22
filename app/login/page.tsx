import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Sparkles } from "lucide-react";
import { APP_SHORT_NAME } from "@/lib/constants";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <div className="bg-premium-glow flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" className="mb-4 flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 shadow-lg shadow-brand-600/30">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
          </Link>
          <h1 className="text-xl font-semibold text-white">Bem-vindo de volta</h1>
          <p className="mt-1 text-sm text-white/50">
            Entre na sua conta {APP_SHORT_NAME} para continuar.
          </p>
        </div>

        <div className="card-gradient rounded-xl border border-surface-700/60 p-6 shadow-2xl">
          <LoginForm />
        </div>

        <p className="mt-6 text-center text-xs text-white/30">
          Autenticação via NextAuth v5 (email e senha). O acesso é provisionado pela sua organização
          — não há cadastro público.
        </p>
      </div>
    </div>
  );
}
