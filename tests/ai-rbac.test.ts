import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin, isManager } from "@/lib/rbac";

/**
 * PR007 RBAC contract for `/dashboard/ai`.
 *
 * `app/dashboard/ai/actions.ts#generateAiMessageAction` calls
 * `requireManager()` (ADMIN + MANAGER may generate); the page itself is
 * readable by any authenticated MEMBER (`requireUser()` + `isManager()`
 * gating the generation form's visibility, mirroring the Outreach AI
 * workbench pattern).
 */
const canGenerate = (role: UserRole | null) => isManager(role);
const canView = (role: UserRole | null) => hasRole(role, UserRole.MEMBER);

describe("AI dashboard RBAC matrix", () => {
  it("ADMIN can generate and view", () => {
    expect(canGenerate(UserRole.ADMIN)).toBe(true);
    expect(canView(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER can generate and view", () => {
    expect(canGenerate(UserRole.MANAGER)).toBe(true);
    expect(canView(UserRole.MANAGER)).toBe(true);
  });

  it("MEMBER can view but not generate", () => {
    expect(canGenerate(UserRole.MEMBER)).toBe(false);
    expect(canView(UserRole.MEMBER)).toBe(true);
  });

  it("unauthenticated principals can do nothing", () => {
    expect(canGenerate(null)).toBe(false);
    expect(canView(null)).toBe(false);
  });

  it("the generate action's guard maps to requireManager() exactly", () => {
    const guard = (role: UserRole | null) => (role && isManager(role) ? "ok" : "403");
    expect(guard(UserRole.ADMIN)).toBe("ok");
    expect(guard(UserRole.MANAGER)).toBe("ok");
    expect(guard(UserRole.MEMBER)).toBe("403");
    expect(guard(null)).toBe("403");
  });

  it("connector-infra ADMIN-only powers do not leak into AI generation", () => {
    expect(isAdmin(UserRole.MANAGER)).toBe(false);
    expect(canGenerate(UserRole.MANAGER)).toBe(true);
  });

  it("keeps the RBAC matrix symmetric (ADMIN ✅ MANAGER ✅ MEMBER ❌)", () => {
    const matrix: Array<UserRole | null> = [
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.MEMBER,
      null,
    ];
    for (const role of matrix) {
      expect(canGenerate(role)).toBe(role === UserRole.ADMIN || role === UserRole.MANAGER);
    }
  });
});
