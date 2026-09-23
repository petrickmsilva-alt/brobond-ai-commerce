import Link from "next/link";
import {
  Sparkles,
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
import { APP_NAME, APP_SHORT_NAME } from "@/lib/constants";

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

export default function LandingPage() {
  return (
    <div className="bg-premium-glow min-h-screen">
      {/* Nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 shadow-[0_8px_24px_-8px_rgba(79,70,229,0.9)]"
          >
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <span className="text-base font-semibold text-white">{APP_SHORT_NAME}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Entrar
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button size="sm">Dashboard</Button>
          </Link>
        </div>
      </header>

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
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link href="/dashboard">
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
