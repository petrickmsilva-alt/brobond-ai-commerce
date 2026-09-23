import { describe, expect, it } from "vitest";
import { navigationGroups, sidebarNav, isNavItemActive, findActiveGroup } from "@/lib/navigation";

/**
 * PR010.1 — Navigation information-architecture tests.
 *
 * The sidebar was regrouped into six enterprise modules. These tests pin the
 * contract the redesign promised: the six groups exist, no route was lost or
 * duplicated in the regrouping, and active-route resolution behaves for both
 * the dashboard root and nested detail pages.
 */

const EXPECTED_GROUPS = ["Overview", "Commerce", "Creators", "Campaigns", "Integrations", "System"];

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
  it("declares exactly the six contracted module groups, in order", () => {
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

  it("flattens to exactly the union of the groups", () => {
    const total = navigationGroups.reduce((sum, group) => sum + group.items.length, 0);
    expect(sidebarNav).toHaveLength(total);
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
    expect(findActiveGroup("/dashboard/tiktok")?.label).toBe("Integrations");
    expect(findActiveGroup("/settings")?.label).toBe("System");
  });

  it("returns null for a route outside the navigation", () => {
    expect(findActiveGroup("/login")).toBeNull();
  });
});

// ------------------------------------------------------------------
// PR010.3 — the access-approval route joins the System module
// ------------------------------------------------------------------

describe("navigation — PR010.3 access route", () => {
  it("lists the access-approval route in the System group", () => {
    const system = navigationGroups.find((group) => group.id === "system");
    expect(system).toBeTruthy();
    const item = system?.items.find((entry) => entry.href === "/dashboard/settings/access");
    expect(item).toBeTruthy();
    expect(item?.label).toBe("Acesso");
  });

  it("keeps the route unique across the whole nav", () => {
    const hrefs = sidebarNav.map((entry) => entry.href);
    expect(hrefs.filter((href) => href === "/dashboard/settings/access")).toHaveLength(1);
  });

  it("resolves the active group for the nested access route", () => {
    expect(findActiveGroup("/dashboard/settings/access")?.label).toBe("System");
  });

  it("resolves the active item for the access route itself", () => {
    const item = sidebarNav.find((entry) => entry.href === "/dashboard/settings/access");
    expect(item).toBeTruthy();
    expect(isNavItemActive("/dashboard/settings/access", "/dashboard/settings/access")).toBe(true);
  });

  it("does not shadow the Dashboard root item", () => {
    expect(isNavItemActive("/dashboard/settings/access", "/dashboard")).toBe(false);
  });

  it("describes the route for the command palette (ADMIN surface)", () => {
    const item = sidebarNav.find((entry) => entry.href === "/dashboard/settings/access");
    expect(item?.description).toMatch(/ADMIN|acesso/i);
  });
});
