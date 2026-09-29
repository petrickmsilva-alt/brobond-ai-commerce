import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import {
  AuthorizationError,
  ROLE_HIERARCHY,
  ROLE_RANK,
  assertRole,
  hasRole,
  isAdmin,
  isManager,
} from "@/lib/rbac";

/**
 * RBAC — hierarchy is ADMIN > MANAGER > MEMBER.
 */
describe("hasRole()", () => {
  it("grants a role access to its own level", () => {
    expect(hasRole(UserRole.ADMIN, UserRole.ADMIN)).toBe(true);
    expect(hasRole(UserRole.MANAGER, UserRole.MANAGER)).toBe(true);
    expect(hasRole(UserRole.MEMBER, UserRole.MEMBER)).toBe(true);
  });

  it("grants higher roles access to lower requirements", () => {
    expect(hasRole(UserRole.ADMIN, UserRole.MANAGER)).toBe(true);
    expect(hasRole(UserRole.ADMIN, UserRole.MEMBER)).toBe(true);
    expect(hasRole(UserRole.MANAGER, UserRole.MEMBER)).toBe(true);
  });

  it("denies lower roles access to higher requirements", () => {
    expect(hasRole(UserRole.MEMBER, UserRole.MANAGER)).toBe(false);
    expect(hasRole(UserRole.MEMBER, UserRole.ADMIN)).toBe(false);
    expect(hasRole(UserRole.MANAGER, UserRole.ADMIN)).toBe(false);
  });

  it("denies when no role is present", () => {
    expect(hasRole(undefined, UserRole.MEMBER)).toBe(false);
    expect(hasRole(null, UserRole.MEMBER)).toBe(false);
    expect(hasRole(null, UserRole.ADMIN)).toBe(false);
  });

  it("keeps the ADMIN > MANAGER > MEMBER ordering", () => {
    expect(ROLE_RANK[UserRole.ADMIN]).toBeGreaterThan(ROLE_RANK[UserRole.MANAGER]);
    expect(ROLE_RANK[UserRole.MANAGER]).toBeGreaterThan(ROLE_RANK[UserRole.MEMBER]);
    expect(ROLE_HIERARCHY).toEqual([UserRole.MEMBER, UserRole.MANAGER, UserRole.ADMIN]);
  });

  it("is transitive across the full matrix", () => {
    for (const [i, role] of ROLE_HIERARCHY.entries()) {
      for (const [j, required] of ROLE_HIERARCHY.entries()) {
        expect(hasRole(role, required)).toBe(i >= j);
      }
    }
  });
});

describe("isAdmin()", () => {
  it("is true only for ADMIN", () => {
    expect(isAdmin(UserRole.ADMIN)).toBe(true);
    expect(isAdmin(UserRole.MANAGER)).toBe(false);
    expect(isAdmin(UserRole.MEMBER)).toBe(false);
  });

  it("is false without a role", () => {
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
  });
});

describe("isManager()", () => {
  it("is true for MANAGER and above", () => {
    expect(isManager(UserRole.ADMIN)).toBe(true);
    expect(isManager(UserRole.MANAGER)).toBe(true);
    expect(isManager(UserRole.MEMBER)).toBe(false);
    expect(isManager(null)).toBe(false);
  });
});

describe("assertRole()", () => {
  it("returns the role when the requirement is met", () => {
    expect(assertRole(UserRole.ADMIN, UserRole.MANAGER)).toBe(UserRole.ADMIN);
    expect(assertRole(UserRole.MEMBER, UserRole.MEMBER)).toBe(UserRole.MEMBER);
  });

  it("throws 403 when the role is insufficient", () => {
    expect(() => assertRole(UserRole.MEMBER, UserRole.ADMIN)).toThrow(AuthorizationError);
    try {
      assertRole(UserRole.MANAGER, UserRole.ADMIN);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).status).toBe(403);
      expect((error as AuthorizationError).message).toContain("ADMIN");
    }
  });

  it("throws 401 when there is no role (unauthenticated)", () => {
    try {
      assertRole(undefined, UserRole.MEMBER);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthorizationError);
      expect((error as AuthorizationError).status).toBe(401);
    }
  });
});
