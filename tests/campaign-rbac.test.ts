import { describe, expect, it } from "vitest";
import { UserRole } from "@prisma/client";
import { hasRole, isManager } from "@/lib/rbac";

describe("campaign engine RBAC", () => {
  it.each([UserRole.ADMIN, UserRole.MANAGER])("allows %s to rebuild an audience", (role) =>
    expect(isManager(role)).toBe(true),
  );
  it("keeps MEMBER read-only", () => {
    expect(hasRole(UserRole.MEMBER, UserRole.MEMBER)).toBe(true);
    expect(isManager(UserRole.MEMBER)).toBe(false);
  });
  it("allows every authenticated role to view recommendations", () => {
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.MEMBER])
      expect(hasRole(role, UserRole.MEMBER)).toBe(true);
  });
});
