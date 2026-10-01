import { describe, expect, it } from "vitest";
import {
  navigationGroups,
  settingsNavItem,
  sidebarNav,
  isNavItemActive,
  isNavItemSelected,
  isNavDisclosure,
  isNavDisclosureActive,
  findActiveGroup,
  type NavDisclosure,
  type NavItem,
} from "@/lib/navigation";

/**
 * PR010.1 — Navigation information-architecture tests.
 * Re-pinned in PR013 (Hub Multicanal de Vendas): "Integrations" was folded
 * into a dedicated, higher-priority "Canais de Venda" group that fronts
 * every revenue-generating connector (Mercado Livre, Shopee, TikTok Shop,
 * Mercado Pago).
 *
 * Re-pinned in PR014 (isolated connector screens): every platform link
 * targets its own route under `/dashboard/connectors/[slug]` instead of the
 * `?platform=` URL-state filter, so clicking a connector in the sidebar
 * renders ONLY that platform's card.
 *
 * Re-pinned in PR015 (collapsible connectors menu): the "Conectores" row is
 * now an accordion disclosure — a TOGGLE, never a link. Clicking it only
 * expands/collapses the list of the individual connectors below it in the
 * sidebar; it never opens the stacked-cards hub page. The hub route stays a
 * page (contextual back-link on each connector screen) but is no longer a
 * sidebar or palette destination, and each connector child keeps its own
 * individual active highlight.
 *
 * These tests pin the contract the redesign promised: five daily-use groups
 * plus a minimal settings footer exist, no route was lost or duplicated, and
 * active-route resolution behaves for both the dashboard root and nested
 * detail pages.
 */

const EXPECTED_GROUPS = ["Overview", "Canais de Venda", "Commerce", "Creators", "Campaigns"];

/**
 * Routes that existed in the flat PR000 nav and must all survive as sidebar
 * destinations. PR015 deliberately removed `/dashboard/connectors` from this
 * list — the stacked hub left the navigation to become a disclosure toggle.
 */
const LEGACY_ROUTES = [
  "/dashboard",
  "/dashboard/products",
  "/dashboard/trends",
  "/dashboard/creators",
  "/dashboard/outreach",
  "/dashboard/ai",
  "/dashboard/matches",
  "/dashboard/campaigns",
  "/dashboard/delivery",
  "/dashboard/analytics",
  "/settings",
];

/** Every destination row the tree can render (links + disclosure children). */
function flatItems(): NavItem[] {
  return navigationGroups.flatMap((group) =>
    group.items.flatMap((entry) => (isNavDisclosure(entry) ? entry.children : [entry])),
  );
}

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

  it("keeps every group scannable (≤ 7 entries)", () => {
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
    expect(sidebarNav).toHaveLength(flatItems().length + 1);
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
    expect(findActiveGroup("/dashboard/connectors")?.label).toBe("Canais de Venda");
    expect(findActiveGroup("/dashboard/connectors/mercado-livre")?.label).toBe("Canais de Venda");
    expect(findActiveGroup("/settings")).toBeNull();
  });

  it("returns null for a route outside the navigation", () => {
    expect(findActiveGroup("/login")).toBeNull();
    // PR014 — the rich TikTok dashboard is a page, no longer a nav item.
    expect(findActiveGroup("/dashboard/tiktok")).toBeNull();
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

// ------------------------------------------------------------------
// PR014 — isolated connector screens (one platform per route)
// ------------------------------------------------------------------

describe("navigation — PR014 isolated connector routes", () => {
  const salesChannels = navigationGroups.find((group) => group.id === "sales-channels");
  const connectors =
    salesChannels?.items.find(isNavDisclosure) ??
    // Narrowing helper: the find above already guarantees the type, but the
    // fallback keeps the accessor honest if the tree is ever restructured.
    salesChannels?.items.find((entry): entry is NavDisclosure => isNavDisclosure(entry));

  it("links every platform to its own isolated screen, not the stacked hub", () => {
    expect(connectors).toBeDefined();
    const hrefs = connectors!.children.map((item) => item.href);
    expect(hrefs).toContain("/dashboard/connectors/mercado-livre");
    expect(hrefs).toContain("/dashboard/connectors/shopee");
    expect(hrefs).toContain("/dashboard/connectors/tiktok");
    expect(hrefs).toContain("/dashboard/connectors/mercado-pago");
    expect(hrefs).toContain("/dashboard/connectors/instagram");
  });

  it("never deep-links through the legacy ?platform= filter", () => {
    for (const item of flatItems()) {
      expect(item.href).not.toMatch(/platform=/);
    }
  });

  it("highlights exactly one item on an isolated connector screen", () => {
    const pathname = "/dashboard/connectors/mercado-livre";
    const active = sidebarNav.filter((item) => isNavItemSelected(pathname, item));
    expect(active.map((item) => item.label)).toEqual(["Mercado Livre"]);
  });

  it("an exact href match beats a prefix match (no ancestor steals the highlight)", () => {
    const pathname = "/dashboard/connectors/shopee";
    const shopee = sidebarNav.find((item) => item.href === "/dashboard/connectors/shopee")!;
    expect(isNavItemSelected(pathname, shopee)).toBe(true);
    // Every other row stays dim — including rows whose href is a prefix of
    // the current route.
    const others = sidebarNav.filter((item) => item !== shopee);
    expect(others.filter((item) => isNavItemSelected(pathname, item))).toEqual([]);
  });
});

// ------------------------------------------------------------------
// PR015 — collapsible connectors menu (accordion, never a navigation)
// ------------------------------------------------------------------

describe("navigation — PR015 collapsible connectors menu", () => {
  const salesChannels = navigationGroups.find((group) => group.id === "sales-channels");
  const connectors = salesChannels!.items.find((entry): entry is NavDisclosure =>
    isNavDisclosure(entry),
  );

  it("the Canais de Venda group has exactly one entry: the Conectores disclosure", () => {
    expect(salesChannels!.items).toHaveLength(1);
    expect(connectors).toBeDefined();
    expect(connectors!.id).toBe("connectors");
    expect(connectors!.label).toBe("Conectores");
  });

  it("the disclosure is a toggle — it carries no href to navigate to", () => {
    expect(connectors).toBeDefined();
    expect("href" in connectors!).toBe(false);
    expect(connectors!.type).toBe("disclosure");
  });

  it("the stacked hub page is no longer a sidebar or palette destination", () => {
    expect(sidebarNav.map((item) => item.href)).not.toContain("/dashboard/connectors");
    expect(flatItems().map((item) => item.href)).not.toContain("/dashboard/connectors");
  });

  it("reveals exactly the five individual connectors, each fully described", () => {
    expect(connectors!.children.map((item) => item.label)).toEqual([
      "Mercado Livre",
      "Shopee",
      "TikTok Shop",
      "Mercado Pago",
      "Instagram Shopping",
    ]);
    for (const child of connectors!.children) {
      expect(child.href.startsWith("/")).toBe(true);
      expect(child.icon, `item ${child.label} icon`).toBeTruthy();
      expect(child.description, `item ${child.label} has no palette description`).toBeTruthy();
    }
  });

  it("marks the disclosure as containing the active connector screen", () => {
    expect(isNavDisclosureActive("/dashboard/connectors/mercado-livre", connectors!)).toBe(true);
    expect(isNavDisclosureActive("/dashboard/connectors/shopee", connectors!)).toBe(true);
  });

  it("still marks the disclosure on the hub route (matchHrefs), for the back-link", () => {
    expect(isNavDisclosureActive("/dashboard/connectors", connectors!)).toBe(true);
  });

  it("stays dim on unrelated routes", () => {
    expect(isNavDisclosureActive("/dashboard/products", connectors!)).toBe(false);
    expect(isNavDisclosureActive("/dashboard", connectors!)).toBe(false);
    expect(isNavDisclosureActive("/dashboard/connectors-amazon", connectors!)).toBe(false);
  });

  it("every connector keeps its own individual active state when open", () => {
    for (const child of connectors!.children) {
      const active = sidebarNav.filter((item) => isNavItemSelected(child.href, item));
      expect(active.map((item) => item.label)).toEqual([child.label]);
    }
  });
});
