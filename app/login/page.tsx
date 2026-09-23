import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { PlatformStatus } from "@/components/auth/platform-status";
import { FadeIn, SlideIn } from "@/components/ui/motion";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";
import { showGoogleProvider } from "@/lib/auth-providers";
import { getCurrentUser } from "@/lib/session";
import { resolveNext, sanitizeNext } from "@/lib/auth-routes";

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
 * Enterprise login (PR010.2 §3 — full refactor).
 *
 * LAYOUT (§3)
 *   Esquerda: brand · headline · benefícios · status da plataforma
 *   Direita:  card glass · email · senha · entrar · Google (condicional) ·
 *             esqueci senha · solicitar acesso
 *
 * BEHAVIOUR
 * ---------
 * - Already authenticated? Redirect straight to the destination instead of
 *   showing a second login form. The middleware does this too; doing it here
 *   as well means a direct server render (or a cached HTML shell) can't leave
 *   a signed-in user staring at a login box.
 * - `?next=` is sanitised HERE (server-side) before it is handed to the form,
 *   and sanitised AGAIN inside the login action. Two independent gates, both
 *   rejecting anything that is not a same-origin absolute path.
 * - The Google button is rendered only when the provider is actually
 *   registered (§4) — `showGoogleProvider()` reads the same environment the
 *   auth config reads, so the button can never point at a 404.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;

  // `null` (not "/dashboard") when absent, so the form only sends a `next`
  // when the user actually had a destination in mind.
  const next = sanitizeNext(rawNext);

  const user = await getCurrentUser();
  if (user) redirect(resolveNext(next));

  const google = showGoogleProvider();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------------- */}
      {/* Left — brand, headline, benefits, platform status                 */}
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

        {/* §13 — the brand column slides in from the edge it sits on.
            `SlideIn` collapses to a static box under
            `prefers-reduced-motion`, so the entrance is opt-out by default. */}
        <SlideIn className="relative max-w-lg">
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
        </SlideIn>

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          {/* §3 — status da plataforma */}
          <PlatformStatus />
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} {APP_NAME}.
          </p>
        </div>
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Right — glass authentication card                                 */}
      {/* ---------------------------------------------------------------- */}
      <main className="bg-app-mesh flex items-center justify-center px-4 py-12 sm:px-8">
        {/* §13 — the card rises 8px into place, a beat after the brand column. */}
        <FadeIn delay={0.06} className="w-full max-w-sm">
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
              <LoginForm next={next} />
            </div>

            {/* §4 — the divider belongs to the Google button: when no provider
                is configured `SsoButtons` renders null, so showing an "ou"
                separator above nothing would be its own small broken promise. */}
            {google && (
              <>
                <div className="my-6 flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-white/8" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                    ou
                  </span>
                  <span className="h-px flex-1 bg-white/8" />
                </div>

                <SsoButtons google={google} callbackUrl={resolveNext(next)} />
              </>
            )}
          </div>

          {/* §3 — solicitar acesso */}
          <p className="mt-6 text-center text-xs leading-relaxed text-white/40">
            Ainda não tem acesso?{" "}
            <Link
              href="/request-access"
              className="font-medium text-brand-300 underline-offset-4 transition-colors hover:text-brand-200 hover:underline"
            >
              Solicitar acesso
            </Link>
          </p>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-white/25">
            O acesso é provisionado pela sua organização — não há cadastro público.
          </p>
        </FadeIn>
      </main>
    </div>
  );
}
