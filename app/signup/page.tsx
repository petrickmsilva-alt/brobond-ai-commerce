import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, CheckCircle2, ShieldCheck, Sparkles, Users, Zap } from "lucide-react";
import { SignupForm } from "@/components/auth/signup-form";
import { SsoButtons } from "@/components/auth/sso-buttons";
import { PlatformStatus } from "@/components/auth/platform-status";
import { FadeIn, SlideIn } from "@/components/ui/motion";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";
import { showGoogleProvider } from "@/lib/auth-providers";
import { getCurrentUser } from "@/lib/session";
import { LOGIN_ROUTE, resolveNext, sanitizeNext } from "@/lib/auth-routes";

export const metadata: Metadata = {
  title: "Criar conta",
};

/**
 * Self-signup — `/signup` (PR010.4 §2 · §3).
 *
 * WHAT THIS REPLACES
 * ------------------
 * `/request-access`, deleted in §1. That page asked a stranger to describe
 * themselves and wait for an email that an ADMIN had to remember to send.
 * This one creates their company's workspace and puts them inside it.
 *
 * LAYOUT (§2 — "tela premium em 2 colunas")
 *   Esquerda: brand · headline · o que você recebe · status da plataforma
 *   Direita:  card glass · formulário completo · Google · link para login
 *
 * BEHAVIOUR
 * ---------
 * - An authenticated visitor is redirected to their destination instead of
 *   being shown a form that would try to mint them a second organization.
 *   The middleware does this too (`/signup` is an AUTH_ROUTE); doing it here
 *   as well means a direct server render cannot leave a signed-in user
 *   staring at a signup box.
 * - `?next=` is sanitised HERE and AGAIN inside the action — two independent
 *   gates, both rejecting anything that is not a same-origin absolute path.
 * - The Google button renders only when the provider is actually registered,
 *   and with PR010.4 §5 it now performs a real first access: an unknown
 *   Google account gets an Organization + ADMIN User + Workspace too.
 */

const included = [
  {
    icon: Users,
    title: "Creator CRM completo",
    description: "Descoberta multi-source, score e pipeline de relacionamento.",
  },
  {
    icon: Zap,
    title: "Campanhas orquestradas",
    description: "Matching produto × creator até a entrega omnichannel.",
  },
  {
    icon: BarChart3,
    title: "Atribuição determinística",
    description: "Receita, margem e ROI sobre os seus próprios dados.",
  },
  {
    icon: ShieldCheck,
    title: "Isolamento por tenant",
    description: "Seu workspace nasce isolado, com RBAC server-side.",
  },
];

const setupHighlights = [
  "Workspace criado automaticamente",
  "Você entra como administrador",
  "Sem cartão de crédito",
];

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawNext = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = sanitizeNext(rawNext);

  const user = await getCurrentUser();
  if (user) redirect(resolveNext(next));

  const google = showGoogleProvider();

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      {/* ------------------------------------------------------------------ */}
      {/* Left — brand, headline, what you get, platform status               */}
      {/* ------------------------------------------------------------------ */}
      <aside className="bg-premium-glow relative hidden flex-col justify-between overflow-hidden border-r border-white/8 bg-surface-900 p-12 lg:flex xl:p-16">
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

        <SlideIn className="relative max-w-lg">
          <h2 className="text-balance text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-[2.75rem]">
            Crie o workspace da sua{" "}
            <span className="bg-gradient-to-r from-brand-300 to-accent-300 bg-clip-text text-transparent">
              operação de creators
            </span>{" "}
            em menos de um minuto.
          </h2>
          <p className="mt-5 text-pretty text-base leading-relaxed text-white/50">
            Sem fila de aprovação e sem convite. Você cria a conta, vira administrador da sua
            organização e já começa a conectar canais, produtos e creators.
          </p>

          <ul className="mt-10 space-y-5">
            {included.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="flex items-start gap-4">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/[0.05] text-brand-300"
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-white/45">
                      {item.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </SlideIn>

        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <PlatformStatus />
          <p className="text-xs text-white/30">
            © {new Date().getFullYear()} {APP_NAME}.
          </p>
        </div>
      </aside>

      {/* ------------------------------------------------------------------ */}
      {/* Right — glass signup card                                           */}
      {/* ------------------------------------------------------------------ */}
      <main className="bg-app-mesh flex items-center justify-center px-4 py-12 sm:px-8">
        <FadeIn delay={0.06} className="w-full max-w-md">
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
            <h1 className="text-xl font-semibold tracking-tight text-white">
              Criar conta no {APP_SHORT_NAME}
            </h1>
            <p className="mt-1.5 text-sm text-white/50">
              Preencha os dados abaixo — sua organização e seu workspace são criados
              automaticamente.
            </p>

            <ul className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5">
              {setupHighlights.map((highlight) => (
                <li key={highlight} className="flex items-center gap-1.5 text-[11px] text-white/45">
                  <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                  {highlight}
                </li>
              ))}
            </ul>

            <div className="mt-7">
              <SignupForm next={next} />
            </div>

            {google && (
              <>
                <div className="my-6 flex items-center gap-3" aria-hidden>
                  <span className="h-px flex-1 bg-white/8" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/30">
                    ou
                  </span>
                  <span className="h-px flex-1 bg-white/8" />
                </div>

                {/* §5 — first access with Google provisions the tenant too. */}
                <SsoButtons google={google} callbackUrl={resolveNext(next)} />
              </>
            )}
          </div>

          {/* §6 — the reciprocal of the "Criar conta" button on /login. */}
          <p className="mt-6 text-center text-xs leading-relaxed text-white/40">
            Já tem uma conta?{" "}
            <Link
              href={LOGIN_ROUTE}
              data-testid="signup-login-link"
              className="font-medium text-brand-300 underline-offset-4 transition-colors hover:text-brand-200 hover:underline"
            >
              Fazer login
            </Link>
          </p>
        </FadeIn>
      </main>
    </div>
  );
}
