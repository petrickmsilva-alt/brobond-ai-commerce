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
  Crown,
  Compass,
  ShoppingBag,
  UsersRound,
  Rocket,
  Cable,
  Store,
  ShoppingBasket,
  Wallet,
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
 * Primary sidebar navigation (PR010.1 · reorganised in PR013 for the Hub
 * Multicanal de Vendas).
 *
 * Five focused module groups — Overview · Canais de Venda · Commerce ·
 * Creators · Campaigns — mirror how the Brobond Wear operator uses the
 * multichannel hub. Configurações is intentionally kept out of this tree and
 * pinned to the sidebar footer, where it remains available without consuming
 * the daily-navigation area. "Canais de Venda" is pinned right after Overview:
 * it is the fastest path
 * to every revenue-generating connector (Mercado Livre, Shopee, TikTok
 * Shop, Mercado Pago, Instagram) and the only group whose items double as
 * the day-to-day operational hub for Brobond's outside-marketplace sales.
 *
 * Deep links into `/dashboard/connectors` reuse its existing `?platform=`
 * URL-state filter (see `components/connectors/content-toolbar.tsx`) — no
 * new route, no new backend surface, zero risk to the connector framework.
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
        description: "Receita, margem e atribuição por canal, produto, creator e campanha",
      },
      {
        label: "AI CEO",
        href: "/dashboard/ceo",
        icon: Crown,
        description: "Decisões executivas auditáveis e oportunidades autônomas",
        badge: { label: "CEO", tone: "brand" },
      },
    ],
  },
  {
    id: "sales-channels",
    label: "Canais de Venda",
    icon: Cable,
    items: [
      {
        label: "Conectores",
        href: "/dashboard/connectors",
        icon: Plug,
        description: "Hub multicanal — status, sincronização e OAuth das 5 plataformas",
      },
      {
        label: "Mercado Livre",
        href: "/dashboard/connectors?platform=MERCADOLIVRE",
        icon: Store,
        description: "Conta, catálogo e pedidos do Mercado Livre",
      },
      {
        label: "Shopee",
        href: "/dashboard/connectors?platform=SHOPEE",
        icon: ShoppingBasket,
        description: "Conta, catálogo e pedidos da Shopee",
      },
      {
        label: "TikTok Shop",
        href: "/dashboard/tiktok",
        icon: Music2,
        description: "Conta, produtos, creators e sincronização",
      },
      {
        label: "Mercado Pago",
        href: "/dashboard/connectors?platform=MERCADOPAGO",
        icon: Wallet,
        description: "Checkout e conciliação via Mercado Pago",
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
        label: "Pedidos",
        href: "/dashboard/orders",
        icon: ShoppingBag,
        description: "Checkout, pagamentos e ciclo de ordem — por canal de venda",
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
];

/** Minimal destination pinned to the footer instead of occupying a nav group. */
export const settingsNavItem: NavItem = {
  label: "Configurações",
  href: "/settings",
  icon: Settings,
  description: "Conta, integrações e preferências do hub",
};

/**
 * Flat list of every navigable item — consumed by the global command palette.
 * The footer destination is included so keyboard navigation remains complete.
 */
export const sidebarNav: NavItem[] = [
  ...navigationGroups.flatMap((group) => group.items),
  settingsNavItem,
];

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
