import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin, isManager } from "@/lib/rbac";
import { canTransitionCreatorStatus } from "@/modules/creators/interfaces/creator.interface";

/**
 * PR003 RBAC contract for the creators module.
 *
 * The server actions enforce:
 *   executar descoberta  → requireAdmin()   (ADMIN only)
 *   criar profile        → requireManager() (MANAGER+)
 *   mover pipeline       → requireManager() (MANAGER+)
 *   visualizar           → requireUser()    (any authenticated member)
 *
 * These tests pin the pure predicates those guards are built on, so a
 * change to the role hierarchy that would silently widen creator
 * permissions fails CI.
 */
const canRunDiscovery = (role: UserRole | null) => isAdmin(role);
const canCreateProfile = (role: UserRole | null) => isManager(role);
const canMovePipeline = (role: UserRole | null) => isManager(role);
const canView = (role: UserRole | null) => hasRole(role, UserRole.MEMBER);

describe("creators RBAC matrix", () => {
  it("ADMIN can run the discovery and manage the CRM", () => {
    expect(canRunDiscovery(UserRole.ADMIN)).toBe(true);
    expect(canCreateProfile(UserRole.ADMIN)).toBe(true);
    expect(canMovePipeline(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER can create profiles and move the pipeline (no discovery)", () => {
    expect(canRunDiscovery(UserRole.MANAGER)).toBe(false);
    expect(canCreateProfile(UserRole.MANAGER)).toBe(true);
    expect(canMovePipeline(UserRole.MANAGER)).toBe(true);
    expect(canView(UserRole.MANAGER)).toBe(true);
  });

  it("MEMBER is read-only", () => {
    expect(canRunDiscovery(UserRole.MEMBER)).toBe(false);
    expect(canCreateProfile(UserRole.MEMBER)).toBe(false);
    expect(canMovePipeline(UserRole.MEMBER)).toBe(false);
    expect(canView(UserRole.MEMBER)).toBe(true);
  });

  it("unauthenticated principals can do nothing (not even view)", () => {
    expect(canRunDiscovery(null)).toBe(false);
    expect(canCreateProfile(null)).toBe(false);
    expect(canMovePipeline(null)).toBe(false);
    expect(canView(null)).toBe(false);
  });

  it("the discovery guard maps to requireAdmin() exactly", () => {
    const guard = (role: UserRole | null) => {
      if (!role || !isAdmin(role)) return "403";
      return "ok";
    };
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("403");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });

  it("the CRM write guards map to requireManager() exactly", () => {
    const guard = (role: UserRole | null) => {
      if (!role || !isManager(role)) return "403";
      return "ok";
    };
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("ok");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });
});

describe("creators RBAC — pipeline powers by role", () => {
  it("pipeline moves are meaningless without the MANAGER guard", () => {
    // The transition itself is legal — the ROLE decides who may use it.
    expect(canTransitionCreatorStatus("NEW", "QUALIFIED")).toBe(true);
    // ...but only MANAGER+ reaches changeCreatorStatusAction.
    expect(canMovePipeline(UserRole.MEMBER)).toBe(false);
  });

  it("role hierarchy invariants hold for the creators module", () => {
    expect(hasRole(UserRole.MANAGER, UserRole.MEMBER)).toBe(true);
    expect(hasRole(UserRole.MANAGER, UserRole.ADMIN)).toBe(false);
    expect(hasRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
    expect(hasRole("SUPERUSER" as UserRole, UserRole.MEMBER)).toBe(false);
  });

  it("an unknown role satisfies nothing", () => {
    expect(isAdmin("OWNER" as UserRole)).toBe(false);
    expect(isManager("OWNER" as UserRole)).toBe(false);
  });
});
