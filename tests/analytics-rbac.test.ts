import { describe, expect, it } from "vitest";
import { isAdmin, isManager } from "@/lib/rbac";

/**
 * PR008 — Analytics & Attribution RBAC matrix.
 * Revenue and margin are business-sensitive: the /dashboard/analytics page
 * and every write action are MANAGER+ (ADMIN included); MEMBER is
 * redirected/denied.
 */
describe("analytics RBAC matrix — PR008", () => {
  it("ADMIN and MANAGER can view and refresh", () => {
    expect(isManager("ADMIN")).toBe(true);
    expect(isManager("MANAGER")).toBe(true);
  });

  it("MEMBER cannot access the analytics dashboard", () => {
    expect(isManager("MEMBER")).toBe(false);
  });

  it("unknown/empty roles are denied defensively", () => {
    type RoleParam = Parameters<typeof isManager>[0];
    expect(isManager(null)).toBe(false);
    expect(isManager(undefined)).toBe(false);
    expect(isManager("" as RoleParam)).toBe(false);
    expect(isManager("SUPERUSER" as RoleParam)).toBe(false);
    expect(isManager("manager" as RoleParam)).toBe(false);
  });

  it("the hierarchy stays monotonic (ADMIN ⊇ MANAGER ⊇ MEMBER)", () => {
    expect(isAdmin("ADMIN")).toBe(true);
    expect(isAdmin("MANAGER")).toBe(false);
    expect(isAdmin("MEMBER")).toBe(false);
  });
});
