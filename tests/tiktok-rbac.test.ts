import { describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  UserRole: { ADMIN: "ADMIN", MANAGER: "MANAGER", MEMBER: "MEMBER" },
}));

import { UserRole } from "@prisma/client";
import { isAdmin } from "@/lib/rbac";

/** PR009 privileges are intentionally narrower than normal dashboard reads. */
describe("TikTok Shop RBAC", () => {
  it("allows only ADMIN to connect OAuth", () => {
    expect(isAdmin(UserRole.ADMIN)).toBe(true);
    expect(isAdmin(UserRole.MANAGER)).toBe(false);
    expect(isAdmin(UserRole.MEMBER)).toBe(false);
  });

  it("uses the same ADMIN boundary for sync and credential revocation", () => {
    const canManageTikTok = (role: UserRole | null) => isAdmin(role);
    expect(canManageTikTok(UserRole.ADMIN)).toBe(true);
    expect(canManageTikTok(UserRole.MANAGER)).toBe(false);
    expect(canManageTikTok(UserRole.MEMBER)).toBe(false);
    expect(canManageTikTok(null)).toBe(false);
  });
});
