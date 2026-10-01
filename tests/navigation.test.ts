import { describe, expect, it } from "vitest";
import {
  navigationGroups,
  settingsNavItem,
  sidebarNav,
  isNavItemActive,
  findActiveGroup,
} from "@/lib/navigation";

/**
 * PR010.1 — Navigation information-architecture tests.
 * Re-pinned in PR013 (Hub Multicanal de Vendas): "Integrations" was folded
 * into a dedicated, higher-priority "Canais de Venda" group that fronts
 * every revenue-generating connector (Mercado Livre, Shopee, TikTok Shop,
 * Mercado Pago).
 *
 * These tests pin the contract the redesign promised: five daily-use groups
 * plus a minimal settings footer exist, no route was lost or duplicated, and active-route
 * resolution behaves for both the dashboard root and nested detail pages.
 */

const EXPECTED_GROUPS = ["Overview", "Canais de Venda", "Commerce", "Creators", "Campaigns"];

/** Routes that existed in the flat PR000 nav and must all survive. */
const LEGACY_ROUTES = [
  "/dashboard",
  "/dashboard/products",
  "/dashboard/trends",
  "/dashboard/creators",
  "/dashboard/outreach",
  "/dashboard/ai",
  "/dashboard/connectors",
  "/dashboard/tiktok",
  "/dashboard/matches",
  "/dashboard/campaigns",
  "/dashboard/delivery",
  "/dashboard/analytics",
  "/settings",
];

describe("navigation — grouping", () => {
  it("declares exactly the five focused module groups, in order", () => {
    expect(navigationGroups.map((group) => group.label)).toEqual(EXPECTED_GROUPS);
  });

  it("gives every group a stable id and an icon", () => {
    const ids = navigationGroups.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of navigationGroups) {
      expect(group.id).toMatch(/^[a-z-]+$/);
      expect(group.icon, `group ${group.label} icon`).toBeTruthy();
    }
  });

  it("never leaves a group empty", () => {
    for (const group of navigationGroups) {
      expect(group.items.length, `group ${group.label}`).toBeGreaterThan(0);
    }
  });

  it("keeps every group scannable (≤ 7 items)", () => {
    for (const group of navigationGroups) {
      expect(group.items.length, `group ${group.label}`).toBeLessThanOrEqual(7);
    }
  });
});

describe("navigation — route integrity", () => {
  it("preserves every route from the pre-redesign flat navigation", () => {
    const hrefs = sidebarNav.map((item) => item.href);
    for (const route of LEGACY_ROUTES) {
      expect(hrefs, `route ${route} disappeared in the regrouping`).toContain(route);
    }
  });

  it("never lists a route in two groups", () => {
    const hrefs = sidebarNav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("flattens the groups and the settings footer into one searchable list", () => {
    const groupedTotal = navigationGroups.reduce((sum, group) => sum + group.items.length, 0);
    expect(sidebarNav).toHaveLength(groupedTotal + 1);
    expect(sidebarNav.at(-1)).toEqual(settingsNavItem);
  });

  it("gives every item a label, an absolute href and an icon", () => {
    for (const item of sidebarNav) {
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.icon, `item ${item.label} icon`).toBeTruthy();
    }
  });

  it("describes every item for the command palette", () => {
    for (const item of sidebarNav) {
      expect(item.description, `item ${item.label} has no palette description`).toBeTruthy();
    }
  });
});

describe("navigation — active route resolution", () => {
  it("matches the dashboard root only exactly", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard/products", "/dashboard")).toBe(false);
    expect(isNavItemActive("/dashboard/analytics", "/dashboard")).toBe(false);
  });

  it("keeps a section active on its nested detail pages", () => {
    expect(isNavItemActive("/dashboard/products", "/dashboard/products")).toBe(true);
    expect(isNavItemActive("/dashboard/products/abc123", "/dashboard/products")).toBe(true);
    expect(isNavItemActive("/dashboard/products/new", "/dashboard/products")).toBe(true);
  });

  it("does not match a sibling route sharing a prefix", () => {
    expect(isNavItemActive("/dashboard/products-archive", "/dashboard/products")).toBe(false);
  });

  it("resolves the owning group of the active route", () => {
    expect(findActiveGroup("/dashboard")?.label).toBe("Overview");
    expect(findActiveGroup("/dashboard/products/abc")?.label).toBe("Commerce");
    expect(findActiveGroup("/dashboard/matches")?.label).toBe("Creators");
    expect(findActiveGroup("/dashboard/delivery")?.label).toBe("Campaigns");
    expect(findActiveGroup("/dashboard/tiktok")?.label).toBe("Canais de Venda");
    expect(findActiveGroup("/settings")).toBeNull();
  });

  it("returns null for a route outside the navigation", () => {
    expect(findActiveGroup("/login")).toBeNull();
  });
});

// ------------------------------------------------------------------
// PR010.4 §1 — the access-approval route left the navigation with its page
// ------------------------------------------------------------------

describe("navigation — PR010.4 removes the access-approval route", () => {
  it("no nav item points at the deleted access-request queue", () => {
    const hrefs = sidebarNav.map((entry) => entry.href);
    expect(hrefs).not.toContain("/dashboard/settings/access");
  });

  it("no nav item points at the deleted public request-access page", () => {
    const hrefs = sidebarNav.map((entry) => entry.href);
    expect(hrefs).not.toContain("/request-access");
  });

  it("keeps Configurações in the minimal footer, outside module groups", () => {
    expect(settingsNavItem.href).toBe("/settings");
    expect(navigationGroups.some((group) => group.items.includes(settingsNavItem))).toBe(false);
  });

  it("every nav href is still unique", () => {
    const hrefs = sidebarNav.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("Configurações does not reopen a daily-use module group", () => {
    expect(findActiveGroup("/settings")).toBeNull();
  });

  it("Configurações resolves as the active item for its own route", () => {
    expect(isNavItemActive("/settings", "/settings")).toBe(true);
  });

  it("/signup is a public auth screen, never a nav destination", () => {
    expect(sidebarNav.map((entry) => entry.href)).not.toContain("/signup");
    expect(findActiveGroup("/signup")).toBeNull();
  });
});
