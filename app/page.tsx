import Link from "next/link";
import {
  ArrowRight,
  Package,
  Users,
  Megaphone,
  BarChart3,
  ShieldCheck,
  Boxes,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LandingHeader } from "@/components/marketing/landing-header";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_AUTHENTICATED_REDIRECT, buildLoginUrl } from "@/lib/auth-routes";

const features = [
  {
    icon: Package,
    title: "Catálogo de Produtos",
    description: "Gestão centralizada de SKUs, preços e status de publicação.",
  },
  {
    icon: Users,
    title: "Rede de Creators",
    description: "Roster de creators com relacionamento e performance.",
  },
  {
    icon: Megaphone,
    title: "Campanhas",
    description: "Orquestração de campanhas conectando produtos e creators.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    description: "Arquitetura pronta para métricas e relatórios (em breve).",
  },
  {
    icon: ShieldCheck,
    title: "Auth Enterprise",
    description: "NextAuth v5 com adapter Prisma e sessões seguras.",
  },
  {
    icon: Boxes,
    title: "Modular por Design",
    description: "Domínios isolados e integrações preparadas para escalar.",
  },
];

/**
 * Landing page (PR010.2 §1).
 *
 * Now an async Server Component: it resolves the session ONCE and hands a
 * single boolean to the header and hero CTAs, so every "Dashboard" affordance
 * points at `/dashboard` for a signed-in visitor and at
 * `/login?next=/dashboard` for everyone else. No CTA on this page can lead to
 * the white error screen any more.
 *
 * `getCurrentUser()` never throws (unlike `requireUser()`), which is exactly
 * what a public page needs.
 */
export default async function LandingPage() {
  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  const dashboardHref = authenticated
    ? DEFAULT_AUTHENTICATED_REDIRECT
    : buildLoginUrl(DEFAULT_AUTHENTICATED_REDIRECT);

  return (
    <div className="bg-premium-glow min-h-screen">
      {/* Nav */}
      <LandingHeader authenticated={authenticated} />

      {/* Hero */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <Badge tone="brand" size="md" className="mb-6" dot>
          Enterprise AI Commerce OS
        </Badge>
        <h1 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-6xl">
          <span className="bg-gradient-to-r from-white via-white to-brand-200 bg-clip-text text-transparent">
            {APP_NAME}
          </span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-balance text-lg text-white/60">
          O sistema operacional enterprise para comércio social orientado a creators. Infraestrutura
          pronta para produção, arquitetura modular e escalável.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          {/* Same §1 rule as the header — resolved server-side, once. */}
          <Link href={dashboardHref}>
            <Button size="lg">
              Acessar Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              Fazer Login
            </Button>
          </Link>
          <Link href="/request-access">
            <Button size="lg" variant="ghost">
              Solicitar acesso
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="glass-edge relative overflow-hidden rounded-2xl border border-white/8 bg-surface-850 bg-gradient-to-b from-white/[0.045] to-transparent p-6 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/15"
              >
                <div
                  aria-hidden
                  className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-brand-500/12 text-brand-300"
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-semibold text-white">{feature.title}</h3>
                <p className="mt-1.5 text-sm text-white/50">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="border-t border-white/8 py-8">
        <p className="text-center text-xs text-white/30">
          © {new Date().getFullYear()} {APP_SHORT_NAME}. Enterprise AI Commerce OS.
        </p>
      </footer>
    </div>
  );
}
