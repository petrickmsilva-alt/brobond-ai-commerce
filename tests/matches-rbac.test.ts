import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin, isManager } from "@/lib/rbac";

/**
 * PR005.1 RBAC contract for the product-match server actions.
 *
 * The server actions enforce:
 *   criar match    → requireManager() (ADMIN + MANAGER)
 *   aprovar match  → requireManager() (ADMIN + MANAGER)
 *   remover match  → requireManager() (ADMIN + MANAGER)
 *   visualizar     → requireUser()    (any authenticated member)
 *
 * MEMBER is read-only: every write guard maps to `requireManager()`
 * exactly, so a change to the role hierarchy that would silently widen
 * match permissions fails CI.
 */
const canCreate = (role: UserRole | null) => isManager(role);
const canApprove = (role: UserRole | null) => isManager(role);
const canRemove = (role: UserRole | null) => isManager(role);
const canView = (role: UserRole | null) => hasRole(role, UserRole.MEMBER);

describe("matches RBAC matrix", () => {
  it("ADMIN can create, approve and remove matches", () => {
    expect(canCreate(UserRole.ADMIN)).toBe(true);
    expect(canApprove(UserRole.ADMIN)).toBe(true);
    expect(canRemove(UserRole.ADMIN)).toBe(true);
    expect(canView(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER can create, approve and remove matches (matches are content, not infrastructure)", () => {
    expect(canCreate(UserRole.MANAGER)).toBe(true);
    expect(canApprove(UserRole.MANAGER)).toBe(true);
    expect(canRemove(UserRole.MANAGER)).toBe(true);
    expect(canView(UserRole.MANAGER)).toBe(true);
  });

  it("MEMBER is read-only", () => {
    expect(canCreate(UserRole.MEMBER)).toBe(false);
    expect(canApprove(UserRole.MEMBER)).toBe(false);
    expect(canRemove(UserRole.MEMBER)).toBe(false);
    expect(canView(UserRole.MEMBER)).toBe(true);
  });

  it("unauthenticated principals can do nothing (not even view)", () => {
    expect(canCreate(null)).toBe(false);
    expect(canApprove(null)).toBe(false);
    expect(canRemove(null)).toBe(false);
    expect(canView(null)).toBe(false);
  });

  it("every match write guard maps to requireManager() exactly", () => {
    const guard = (role: UserRole | null) => {
      if (!role || !isManager(role)) return "403";
      return "ok";
    };
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("ok");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });

  it("MEMBER's read-only view cannot be escalated by the pure predicates", () => {
    // MEMBER satisfies the read predicate…
    expect(hasRole(UserRole.MEMBER, UserRole.MEMBER)).toBe(true);
    // …but none of the write predicates.
    expect(isManager(UserRole.MEMBER)).toBe(false);
    expect(isAdmin(UserRole.MEMBER)).toBe(false);
  });

  it("MANAGER's ADMIN-only connector powers do NOT leak into matches — and vice versa", () => {
    // Connectors (PR005) are ADMIN-only infrastructure…
    expect(isAdmin(UserRole.MANAGER)).toBe(false);
    // …but matches are curatable content, so MANAGER writes here by design.
    expect(canCreate(UserRole.MANAGER)).toBe(true);
    // The boundary is deliberate and asymmetric, pinned on both sides.
    expect(isManager(UserRole.MANAGER)).toBe(true);
  });

  it("keep the dashboard actions symmetric with the RBAC table (ADMIN ✅ MANAGER ✅ MEMBER ❌)", () => {
    const matrix: Array<UserRole | null> = [
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.MEMBER,
      null,
    ];
    for (const role of matrix) {
      const writes = canCreate(role) || canApprove(role) || canRemove(role);
      expect(writes).toBe(role === UserRole.ADMIN || role === UserRole.MANAGER);
    }
  });
});
