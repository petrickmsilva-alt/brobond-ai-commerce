import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Login",
};

const benefits = [
  {
    icon: Users,
    title: "Creator CRM multi-source",
    description: "Descoberta, score e pipeline de relacionamento em um só lugar.",
  },
  {
    icon: Zap,
    title: "Campanhas orquestradas",
    description: "Do matching produto × creator até a entrega omnichannel.",
  },
  {
    icon: BarChart3,
    title: "Atribuição determinística",
    description: "Receita, margem e ROI calculados sobre os seus próprios dados.",
  },
  {
    icon: ShieldCheck,
    title: "Segurança enterprise",
    description: "Multi-tenancy estrito, RBAC server-side e tokens cifrados.",
  },
];

/**
 * Premium login (PR010.1).
 *
 * Two-column layout: a brand/value panel on the left (hidden below `lg`, where
 * it collapses into a compact header) and the glass authentication card on the
 * right. The MFA step is reserved in the markup as a documented placeholder —
 * no MFA behaviour ships in this UI-only PR.
 */
export default function LoginPage() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Left — brand, headline, benefits                                  */}
      {/* ---------------------------------------------------------------- */}
      <aside className="bg-premium-glow relative hidden flex-col justify-between overflow-hidden border-r border-white/8 bg-surface-900 p-12 lg:flex xl:p-16">
        {/* Decorative gradient orbs */}
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-1/4 h-96 w-96 rounded-full bg-brand-600/18 blur-[120px]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-full bg-accent-600/14 blur-[120px]"
        />

        <Link
          href="/"
          className="relative flex w-fit items-center gap-3 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-900"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]">
            <Sparkles aria-hidden className="h-5 w-5 text-white" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
              AI Commerce OS
            </span>
          </span>
        </Link>

        <div className="relative max-w-lg">
          <h2 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-[2.75rem]">
            O sistema operacional do{" "}
            <span className="bg-gradient-to-r from-brand-300 to-accent-300 bg-clip-text text-transparent">
              comércio social
            </span>{" "}
            orientado a creators.
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/50">
            Catálogo, creators, campanhas, entrega e atribuição — um único fluxo, com dados que
            nunca saem do seu tenant.
          </p>

          <ul className="mt-10 space-y-5">
            {benefits.map((benefit) => {
              const Icon = benefit.icon;
              return (
                <li key={benefit.title} className="flex items-start gap-4">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.05] text-brand-300"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{benefit.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/45">
                      {benefit.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-xs text-white/30">
          © {new Date().getFullYear()} {APP_NAME}.
        </p>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Right — authentication card                                       */}
      {/* ---------------------------------------------------------------- */}
      <main className="bg-app-mesh flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* Compact brand lockup for viewports without the left panel. */}
          <Link
            href="/"
            className="mb-8 flex w-fit items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 lg:hidden"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600">
              <Sparkles aria-hidden className="h-4.5 w-4.5 text-white" />
            </span>
            <span className="text-sm font-semibold text-white">{APP_SHORT_NAME}</span>
          </Link>

          <div className="glass-panel glass-edge relative overflow-hidden rounded-2xl p-7 sm:p-8">
            <h1 className="text-xl font-semibold tracking-tight text-white">Bem-vindo de volta</h1>
            <p className="mt-1.5 text-sm text-white/50">
              Entre na sua conta {APP_SHORT_NAME} para continuar.
            </p>

            <div className="mt-7">
              <LoginForm />
            </div>

            {/* ------------------------------------------------------------
                MFA STEP — RESERVED SLOT (PR010.1)

                The second-factor challenge renders here, between the
                credentials form and the federated providers, once MFA is
                enabled in the auth domain (`lib/auth.ts`). No MFA logic ships
                in this UI-only PR: adding a factor changes the authentication
                contract and belongs to an auth PR.
               ------------------------------------------------------------ */}

            <div className="my-6 flex items-center gap-3" aria-hidden>
              <span className="h-px flex-1 bg-white/8" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                ou
              </span>
              <span className="h-px flex-1 bg-white/8" />
            </div>

            <SsoButtons />
          </div>

          <p className="mt-6 text-center text-xs leading-relaxed text-white/30">
            O acesso é provisionado pela sua organização — não há cadastro público.
          </p>
        </div>
      </main>
    </div>
  );
}
