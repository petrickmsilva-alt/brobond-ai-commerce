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
  Cloud,
  Store,
  ShoppingBasket,
  Wallet,
  Instagram,
} from "lucide-react";
import { connectorProviderPath } from "@/modules/marketplace/core/providers";

export interface NavItem {
  /** Discriminator slot — `undefined` for links, `"disclosure"` for accordions. */
  type?: undefined;
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

/**
 * A collapsible (accordion) sidebar entry (PR015).
 *
 * A NavDisclosure is a TOGGLE, never a link: clicking it only expands or
 * collapses the list of its `children` right below it in the sidebar. The
 * individual destinations are the children themselves — each one keeps its
 * own `active` state when its route is open.
 */
export interface NavDisclosure {
  /** Discriminator — a NavDisclosure toggles a sublist, it never navigates. */
  type: "disclosure";
  /** Stable key used for the collapse-state store. */
  id: string;
  label: string;
  icon: LucideIcon;
  /** Short description shown in the global command palette. */
  description?: string;
  /**
   * Routes that keep the disclosure marked as "contains the current page"
   * even though they are not rendered as links — e.g. the connectors hub,
   * which remains a routed page (contextual back-link) but is no longer a
   * primary sidebar destination.
   */
  matchHrefs?: string[];
  /** The individual destinations revealed by the disclosure. */
  children: NavItem[];
}

/** Anything that can live inside a navigation group. */
export type NavEntry = NavItem | NavDisclosure;

export interface NavGroup {
  /** Stable key used for the collapse-state store. */
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavEntry[];
}

/** Type guard: is this group entry an accordion disclosure (not a link)? */
export function isNavDisclosure(entry: NavEntry): entry is NavDisclosure {
  return entry.type === "disclosure";
}

/**
 * Primary sidebar navigation (PR010.1 · reorganised in PR013 for the Hub
 * Multicanal de Vendas · isolated per-platform routes in PR014 · collapsible
 * connectors menu in PR015).
 *
 * Five focused module groups — Overview · Canais de Venda · Commerce ·
 * Creators · Campaigns — mirror how the Brobond Wear operator uses the
 * multichannel hub. Configurações is intentionally kept out of this tree and
 * pinned to the sidebar footer, where it remains available without consuming
 * the daily-navigation area.
 *
 * PR015 — Menu "Conectores" colapsável: the "Canais de Venda" group no longer
 * stacks the hub link plus five platform links. Its single entry is a
 * `NavDisclosure` named "Conectores" that ONLY expands/collapses the list of
 * the individual connectors right below it — clicking it never navigates and
 * never opens the full stacked-cards hub page. Each child keeps its own
 * isolated route under `/dashboard/connectors/[slug]` (e.g.
 * `/dashboard/connectors/mercado-livre`) and its own active highlight. The
 * slugs come from the client-safe provider registry
 * (`modules/marketplace/core/providers.ts`), the single source of truth
 * shared with the dynamic route.
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
        type: "disclosure",
        id: "connectors",
        label: "Conectores",
        icon: Plug,
        description:
          "Expandir os canais de venda — Mercado Livre, Shopee, Nuvemshop, TikTok Shop, Mercado Pago e Instagram",
        // The stacked hub stays a routed page (contextual "Voltar ao hub"
        // link on each connector screen) but is no longer a sidebar
        // destination: clicking "Conectores" only toggles the list below.
        matchHrefs: ["/dashboard/connectors"],
        children: [
          {
            label: "Mercado Livre",
            href: connectorProviderPath("MERCADOLIVRE"),
            icon: Store,
            description: "Conta, credenciais, pedidos e vendas do Mercado Livre",
          },
          {
            label: "Shopee",
            href: connectorProviderPath("SHOPEE"),
            icon: ShoppingBasket,
            description: "Conta, credenciais, catálogo e vendas da Shopee",
          },
          {
            label: "Nuvemshop",
            href: connectorProviderPath("NUVEMSHOP"),
            icon: Cloud,
            description: "Loja, catálogo, pedidos e vendas da Nuvemshop",
          },
          {
            label: "TikTok Shop",
            href: connectorProviderPath("TIKTOK"),
            icon: Music2,
            description: "Conta, credenciais e vendas do TikTok Shop",
          },
          {
            label: "Mercado Pago",
            href: connectorProviderPath("MERCADOPAGO"),
            icon: Wallet,
            description: "Credenciais, checkout e conciliação via Mercado Pago",
          },
          {
            label: "Instagram Shopping",
            href: connectorProviderPath("INSTAGRAM"),
            icon: Instagram,
            description: "Conta, credenciais e catálogo do Instagram Shopping",
          },
        ],
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
 *
 * PR015 — accordion disclosures contribute their CHILDREN: the individual
 * connectors are the navigable units now, and the stacked hub page is
 * deliberately not a palette destination (it remains reachable through the
 * contextual back-link on each connector screen).
 */
export const sidebarNav: NavItem[] = [
  ...navigationGroups.flatMap((group) =>
    group.items.flatMap((entry) => (isNavDisclosure(entry) ? entry.children : [entry])),
  ),
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

/**
 * Whether `item` is THE highlighted nav entry for `pathname` (PR014).
 *
 * An exact href match always wins over a prefix match: on
 * `/dashboard/connectors/mercado-livre` the "Mercado Livre" item is
 * highlighted while no other row is — `isNavItemActive` alone would light up
 * every ancestor prefix at once.
 */
export function isNavItemSelected(
  pathname: string,
  item: NavItem,
  items: readonly NavItem[] = sidebarNav,
): boolean {
  const hasExactMatch = items.some((candidate) => candidate.href === pathname);
  if (hasExactMatch) return item.href === pathname;
  return isNavItemActive(pathname, item.href);
}

/**
 * Whether a disclosure contains the current route (PR015) — one of its
 * children is active, or the route lives under one of its `matchHrefs`
 * (e.g. the connectors hub). Drives the highlighted-but-not-active header
 * style and the auto-expand behaviour in the sidebar.
 */
export function isNavDisclosureActive(pathname: string, disclosure: NavDisclosure): boolean {
  return (
    disclosure.children.some((child) => isNavItemActive(pathname, child.href)) ||
    (disclosure.matchHrefs ?? []).some((href) => isNavItemActive(pathname, href))
  );
}

/** The group containing the active route, or `null`. */
export function findActiveGroup(pathname: string): NavGroup | null {
  return (
    navigationGroups.find((group) =>
      group.items.some((entry) =>
        isNavDisclosure(entry)
          ? isNavDisclosureActive(pathname, entry)
          : isNavItemActive(pathname, entry.href),
      ),
    ) ?? null
  );
}
