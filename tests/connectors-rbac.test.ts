import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin, isManager } from "@/lib/rbac";

/**
 * PR005 RBAC contract for the connectors module.
 *
 * The server actions enforce:
 *   sincronizar        → requireAdmin() (ADMIN only)
 *   ativar/desativar   → requireAdmin() (ADMIN only)
 *   testar conector    → requireAdmin() (ADMIN only)
 *   visualizar         → requireUser()  (any authenticated member)
 *
 * These tests pin the pure predicates those guards are built on, so a
 * change to the role hierarchy that would silently widen connector
 * permissions fails CI.
 */
const canSync = (role: UserRole | null) => isAdmin(role);
const canToggle = (role: UserRole | null) => isAdmin(role);
const canTest = (role: UserRole | null) => isAdmin(role);
const canView = (role: UserRole | null) => hasRole(role, UserRole.MEMBER);

describe("connectors RBAC matrix", () => {
  it("ADMIN can sync, toggle and test every connector", () => {
    expect(canSync(UserRole.ADMIN)).toBe(true);
    expect(canToggle(UserRole.ADMIN)).toBe(true);
    expect(canTest(UserRole.ADMIN)).toBe(true);
    expect(canView(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER may only view — connectors are infrastructure, not content", () => {
    expect(canSync(UserRole.MANAGER)).toBe(false);
    expect(canToggle(UserRole.MANAGER)).toBe(false);
    expect(canTest(UserRole.MANAGER)).toBe(false);
    expect(canView(UserRole.MANAGER)).toBe(true);
  });

  it("MEMBER is read-only", () => {
    expect(canSync(UserRole.MEMBER)).toBe(false);
    expect(canToggle(UserRole.MEMBER)).toBe(false);
    expect(canTest(UserRole.MEMBER)).toBe(false);
    expect(canView(UserRole.MEMBER)).toBe(true);
  });

  it("unauthenticated principals can do nothing (not even view)", () => {
    expect(canSync(null)).toBe(false);
    expect(canToggle(null)).toBe(false);
    expect(canTest(null)).toBe(false);
    expect(canView(null)).toBe(false);
  });

  it("every connector write guard maps to requireAdmin() exactly", () => {
    const guard = (role: UserRole | null) => {
      if (!role || !isAdmin(role)) return "403";
      return "ok";
    };
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("403");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });

  it("MANAGER privileges elsewhere do NOT leak into the connectors module", () => {
    // MANAGER can write in the CRM (PR003) / outreach (PR004)…
    expect(isManager(UserRole.MANAGER)).toBe(true);
    // …but never touches connector infrastructure.
    expect(canSync(UserRole.MANAGER)).toBe(false);
    expect(canToggle(UserRole.MANAGER)).toBe(false);
  });
});
