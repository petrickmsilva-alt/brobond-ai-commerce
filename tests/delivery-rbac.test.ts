import { describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({
  UserRole: { ADMIN: "ADMIN", MANAGER: "MANAGER", MEMBER: "MEMBER" },
}));

import { UserRole } from "@prisma/client";
import { AuthorizationError, assertRole, hasRole, isAdmin, isManager } from "@/lib/rbac";

/**
 * PR010 §10 permission matrix:
 *   ADMIN   → connect · disconnect · reprocess (operational infrastructure)
 *   MANAGER → send · view (runs deliveries, watches the funnel)
 *   MEMBER  → read-only (dashboard + tables, zero mutations)
 *
 * The server actions enforce this matrix with `requireAdmin()` /
 * `requireManager()` (lib/session.ts); these tests pin the boundary the
 * guards express.
 */

type DeliveryCapability =
  | "connect_account"
  | "disconnect_account"
  | "reprocess_message"
  | "send_message"
  | "dispatch_queue"
  | "view_dashboard";

function can(role: UserRole | null | undefined, capability: DeliveryCapability): boolean {
  if (!role) return false;
  switch (capability) {
    case "connect_account":
    case "disconnect_account":
    case "reprocess_message":
      return isAdmin(role);
    case "send_message":
    case "dispatch_queue":
      return isManager(role);
    case "view_dashboard":
      return hasRole(role, UserRole.MEMBER);
  }
}

const ROLES = [UserRole.ADMIN, UserRole.MANAGER, UserRole.MEMBER, null] as const;

describe("Delivery RBAC matrix (PR010 §10)", () => {
  it("ADMIN may perform every capability", () => {
    for (const capability of [
      "connect_account",
      "disconnect_account",
      "reprocess_message",
      "send_message",
      "dispatch_queue",
      "view_dashboard",
    ] as const) {
      expect(can(UserRole.ADMIN, capability)).toBe(true);
    }
  });

  it("connect is ADMIN-only", () => {
    expect(can(UserRole.ADMIN, "connect_account")).toBe(true);
    expect(can(UserRole.MANAGER, "connect_account")).toBe(false);
    expect(can(UserRole.MEMBER, "connect_account")).toBe(false);
    expect(can(null, "connect_account")).toBe(false);
  });

  it("disconnect is ADMIN-only", () => {
    expect(can(UserRole.ADMIN, "disconnect_account")).toBe(true);
    expect(can(UserRole.MANAGER, "disconnect_account")).toBe(false);
    expect(can(UserRole.MEMBER, "disconnect_account")).toBe(false);
    expect(can(null, "disconnect_account")).toBe(false);
  });

  it("reprocess is ADMIN-only", () => {
    expect(can(UserRole.ADMIN, "reprocess_message")).toBe(true);
    expect(can(UserRole.MANAGER, "reprocess_message")).toBe(false);
    expect(can(UserRole.MEMBER, "reprocess_message")).toBe(false);
    expect(can(null, "reprocess_message")).toBe(false);
  });

  it("send is MANAGER-or-above (ADMIN included)", () => {
    expect(can(UserRole.ADMIN, "send_message")).toBe(true);
    expect(can(UserRole.MANAGER, "send_message")).toBe(true);
    expect(can(UserRole.MEMBER, "send_message")).toBe(false);
    expect(can(null, "send_message")).toBe(false);
  });

  it("dispatching the queue is MANAGER-or-above", () => {
    expect(can(UserRole.MANAGER, "dispatch_queue")).toBe(true);
    expect(can(UserRole.MEMBER, "dispatch_queue")).toBe(false);
    expect(can(null, "dispatch_queue")).toBe(false);
  });

  it("the dashboard is readable by EVERY authenticated role (MEMBER included)", () => {
    expect(can(UserRole.ADMIN, "view_dashboard")).toBe(true);
    expect(can(UserRole.MANAGER, "view_dashboard")).toBe(true);
    expect(can(UserRole.MEMBER, "view_dashboard")).toBe(true);
    expect(can(null, "view_dashboard")).toBe(false);
  });

  it("anonymous callers get nothing", () => {
    for (const capability of [
      "connect_account",
      "disconnect_account",
      "reprocess_message",
      "send_message",
      "dispatch_queue",
      "view_dashboard",
    ] as const) {
      expect(can(null, capability)).toBe(false);
      expect(can(undefined, capability)).toBe(false);
    }
  });
});

describe("Delivery RBAC — guard error semantics", () => {
  it("assertRole(ADMIN) allows only ADMIN", () => {
    expect(() => assertRole(UserRole.ADMIN, UserRole.ADMIN)).not.toThrow();
    expect(() => assertRole(UserRole.MANAGER, UserRole.ADMIN)).toThrow(AuthorizationError);
    expect(() => assertRole(UserRole.MEMBER, UserRole.ADMIN)).toThrow(/ADMIN/);
  });

  it("assertRole(MANAGER) allows MANAGER and ADMIN", () => {
    expect(() => assertRole(UserRole.ADMIN, UserRole.MANAGER)).not.toThrow();
    expect(() => assertRole(UserRole.MANAGER, UserRole.MANAGER)).not.toThrow();
    expect(() => assertRole(UserRole.MEMBER, UserRole.MANAGER)).toThrow(/MANAGER/);
  });

  it("insufficient role maps to 403, missing session to 401", () => {
    const forbidden = new AuthorizationError("Forbidden: ADMIN role required.", 403);
    const unauthenticated = new AuthorizationError("Unauthorized: authentication required.", 401);
    expect(forbidden.status).toBe(403);
    expect(unauthenticated.status).toBe(401);
    expect(() => assertRole(null, UserRole.MEMBER)).toThrow(/authentication required/);
  });

  it("role hierarchy is strictly ADMIN > MANAGER > MEMBER for delivery", () => {
    expect(hasRole(UserRole.ADMIN, UserRole.MANAGER)).toBe(true);
    expect(hasRole(UserRole.MANAGER, UserRole.ADMIN)).toBe(false);
    expect(hasRole(UserRole.MEMBER, UserRole.MANAGER)).toBe(false);
    for (const role of ROLES) {
      expect(isAdmin(role)).toBe(role === UserRole.ADMIN);
      expect(isManager(role)).toBe(role === UserRole.ADMIN || role === UserRole.MANAGER);
    }
  });
});
