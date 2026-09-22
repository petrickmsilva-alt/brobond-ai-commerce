import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isAdmin } from "@/lib/rbac";

/**
 * PR001 RBAC contract for the products module.
 *
 * The server actions enforce:
 *   create  → requireAdmin()    (ADMIN only)
 *   edit    → requireManager()  (MANAGER or ADMIN)
 *   delete  → requireAdmin()    (ADMIN only)
 *   read    → requireUser()     (any authenticated member of the org)
 *
 * These tests pin the pure predicates those guards are built on, so a change
 * to the role hierarchy that would silently widen product permissions fails CI.
 */
const canCreate = (role: UserRole) => isAdmin(role);
const canEdit = (role: UserRole) => hasRole(role, UserRole.MANAGER);
const canDelete = (role: UserRole) => isAdmin(role);

describe("products RBAC matrix", () => {
  it("ADMIN can create, edit and delete", () => {
    expect(canCreate(UserRole.ADMIN)).toBe(true);
    expect(canEdit(UserRole.ADMIN)).toBe(true);
    expect(canDelete(UserRole.ADMIN)).toBe(true);
  });

  it("MANAGER can edit but not create or delete", () => {
    expect(canCreate(UserRole.MANAGER)).toBe(false);
    expect(canEdit(UserRole.MANAGER)).toBe(true);
    expect(canDelete(UserRole.MANAGER)).toBe(false);
  });

  it("MEMBER is read-only", () => {
    expect(canCreate(UserRole.MEMBER)).toBe(false);
    expect(canEdit(UserRole.MEMBER)).toBe(false);
    expect(canDelete(UserRole.MEMBER)).toBe(false);
  });
});
