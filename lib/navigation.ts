import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Package, Users, Megaphone, BarChart3, Settings } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** When true, the route is scaffolding only (prepared, not yet built). */
  planned?: boolean;
}

/**
 * Primary sidebar navigation.
 * Routes flagged `planned` are prepared architecture for future PRs.
 */
export const sidebarNav: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Produtos", href: "/dashboard/products", icon: Package },
  { label: "Creators", href: "/dashboard/creators", icon: Users, planned: true },
  { label: "Campanhas", href: "/dashboard/campaigns", icon: Megaphone, planned: true },
  { label: "Analytics", href: "/dashboard/analytics", icon: BarChart3, planned: true },
  { label: "Configurações", href: "/settings", icon: Settings },
];
