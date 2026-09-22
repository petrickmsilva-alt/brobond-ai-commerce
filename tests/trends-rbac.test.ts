import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin } from "@/lib/rbac";

/**
 * PR002 RBAC contract for the trends module.
 *
 * The server actions enforce:
 *   executar coleta  → requireAdmin()  (ADMIN only)
 *   criar snapshot   → requireAdmin()  (ADMIN only)
 *   visualizar       → requireUser()   (any authenticated member of the org)
 *
 * These tests pin the pure predicates those guards are built on, so a change
 * to the role hierarchy that would silently widen trend permissions fails CI.
 */
const canRunCollection = (role: UserRole | null) => isAdmin(role);
const canCreateSnapshot = (role: UserRole | null) => isAdmin(role);
const canView = (role: UserRole | null) => hasRole(role, UserRole.MEMBER);

describe("trends RBAC matrix", () => {
  it("ADMIN can run the collection and create snapshots", () => {
    expect(canRunCollection(UserRole.ADMIN)).toBe(true);
    expect(canCreateSnapshot(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER can only view (no collection, no snapshot creation)", () => {
    expect(canRunCollection(UserRole.MANAGER)).toBe(false);
    expect(canCreateSnapshot(UserRole.MANAGER)).toBe(false);
    expect(canView(UserRole.MANAGER)).toBe(true);
  });

  it("MEMBER is read-only", () => {
    expect(canRunCollection(UserRole.MEMBER)).toBe(false);
    expect(canCreateSnapshot(UserRole.MEMBER)).toBe(false);
    expect(canView(UserRole.MEMBER)).toBe(true);
  });

  it("unauthenticated principals can do nothing (not even view)", () => {
    expect(canRunCollection(null)).toBe(false);
    expect(canCreateSnapshot(null)).toBe(false);
    expect(canView(null)).toBe(false);
  });

  it("the write guards map to requireAdmin() exactly", () => {
    // requireAdmin() throws unless the role is ADMIN — mirrored here for
    // the two trends write actions.
    const guard = (role: UserRole | null) => {
      if (!role || !isAdmin(role)) return "403";
      return "ok";
    };
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("403");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });
});

describe("trends RBAC — role hierarchy invariants", () => {
  it("MANAGER outranks MEMBER but not ADMIN", () => {
    expect(hasRole(UserRole.MANAGER, UserRole.MEMBER)).toBe(true);
    expect(hasRole(UserRole.MANAGER, UserRole.ADMIN)).toBe(false);
  });

  it("ADMIN satisfies every requirement in the hierarchy", () => {
    expect(hasRole(UserRole.ADMIN, UserRole.MEMBER)).toBe(true);
    expect(hasRole(UserRole.ADMIN, UserRole.MANAGER)).toBe(true);
    expect(hasRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
  });

  it("an unknown role satisfies nothing", () => {
    expect(hasRole("SUPERUSER" as UserRole, UserRole.MEMBER)).toBe(false);
  });
});
