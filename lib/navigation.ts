import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Package,
  TrendingUp,
  Users,
  Megaphone,
  BarChart3,
  MessagesSquare,
  Plug,
  Music2,
  Link2,
  Send,
  Settings,
  Sparkles,
  Compass,
  ShoppingBag,
  UsersRound,
  Rocket,
  Cable,
  SlidersHorizontal,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Short description shown in the global command palette. */
  description?: string;
  /** When true, the route is scaffolding only (prepared, not yet built). */
  planned?: boolean;
  /** Optional badge rendered at the end of the row. */
  badge?: { label: string; tone: "brand" | "neutral" | "success" | "warning" | "accent" };
}

export interface NavGroup {
  /** Stable key used for the collapse-state store. */
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
}

/**
 * Primary sidebar navigation (PR010.1).
 *
 * The flat PR000 list is now organised into six enterprise module groups —
 * Overview · Commerce · Creators · Campaigns · Integrations · System — which
 * mirrors how operators actually think about the product and keeps each group
 * under the ~7-item limit that keeps a rail scannable.
 *
 * Routes are unchanged: this is purely an information-architecture change.
 */
export const navigationGroups: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    icon: Compass,
    items: [
      {
        label: "Dashboard",
        href: "/dashboard",
        icon: LayoutDashboard,
        description: "Visão geral de GMV, pedidos, creators e ROI",
      },
      {
        label: "Analytics",
        href: "/dashboard/analytics",
        icon: BarChart3,
        description: "Receita, margem e atribuição por dimensão",
      },
    ],
  },
  {
    id: "commerce",
    label: "Commerce",
    icon: ShoppingBag,
    items: [
      {
        label: "Produtos",
        href: "/dashboard/products",
        icon: Package,
        description: "Catálogo, variantes, custos e margem",
      },
      {
        label: "Trends",
        href: "/dashboard/trends",
        icon: TrendingUp,
        description: "Trend Hunter — oportunidades pontuadas",
      },
    ],
  },
  {
    id: "creators",
    label: "Creators",
    icon: UsersRound,
    items: [
      {
        label: "Creators",
        href: "/dashboard/creators",
        icon: Users,
        description: "CRM de creators e pipeline de relacionamento",
      },
      {
        label: "Matches",
        href: "/dashboard/matches",
        icon: Link2,
        description: "Pareamento produto × creator com score",
      },
      {
        label: "Outreach AI",
        href: "/dashboard/outreach",
        icon: MessagesSquare,
        description: "Mensagens, cadência e outbox de abordagem",
      },
    ],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    icon: Rocket,
    items: [
      {
        label: "Campanhas",
        href: "/dashboard/campaigns",
        icon: Megaphone,
        description: "Orquestração de campanhas e audiências",
      },
      {
        label: "Delivery",
        href: "/dashboard/delivery",
        icon: Send,
        description: "Envio omnichannel e recibos de entrega",
      },
      {
        label: "IA — Personalização",
        href: "/dashboard/ai",
        icon: Sparkles,
        description: "Geração de mensagens personalizadas",
        badge: { label: "IA", tone: "accent" },
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: Cable,
    items: [
      {
        label: "Conectores",
        href: "/dashboard/connectors",
        icon: Plug,
        description: "Importação de conteúdo externo por plataforma",
      },
      {
        label: "TikTok Shop",
        href: "/dashboard/tiktok",
        icon: Music2,
        description: "Conta, produtos, creators e sincronização",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: SlidersHorizontal,
    items: [
      {
        label: "Configurações",
        href: "/settings",
        icon: Settings,
        description: "Organização, membros e preferências",
      },
    ],
  },
];

/**
 * Flat list of every navigable item — consumed by the global command palette
 * (Ctrl/⌘+K) and by active-route resolution.
 */
export const sidebarNav: NavItem[] = navigationGroups.flatMap((group) => group.items);

/**
 * Resolve whether a nav item is the active route.
 *
 * `/dashboard` matches only exactly (every other route is nested under it);
 * all other items also match their descendant routes (e.g. a product detail
 * page keeps "Produtos" highlighted).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The group containing the active route, or `null`. */
export function findActiveGroup(pathname: string): NavGroup | null {
  return (
    navigationGroups.find((group) =>
      group.items.some((item) => isNavItemActive(pathname, item.href)),
    ) ?? null
  );
}
