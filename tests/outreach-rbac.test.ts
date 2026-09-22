import { describe, expect, it } from "vitest";
import {
  canOutreach,
  type OutreachPermission,
  type OutreachRole,
} from "@/modules/outreach/interfaces/outreach.interface";

const permissions: OutreachPermission[] = [
  "READ",
  "GENERATE",
  "EDIT_MESSAGE",
  "SCHEDULE",
  "CANCEL",
  "CREATE_TEMPLATE",
  "EDIT_TEMPLATE",
];

describe("Outreach RBAC", () => {
  it.each(permissions)("ADMIN may %s", (permission) =>
    expect(canOutreach("ADMIN", permission)).toBe(true),
  );
  it.each(["READ", "GENERATE", "EDIT_MESSAGE", "SCHEDULE"] as const)(
    "MANAGER may %s",
    (permission) => expect(canOutreach("MANAGER", permission)).toBe(true),
  );
  it.each(["CANCEL", "CREATE_TEMPLATE", "EDIT_TEMPLATE"] as const)(
    "MANAGER may not %s",
    (permission) => expect(canOutreach("MANAGER", permission)).toBe(false),
  );
  it("MEMBER is read-only", () => {
    for (const permission of permissions)
      expect(canOutreach("MEMBER", permission)).toBe(permission === "READ");
  });
  it.each(["ADMIN", "MANAGER", "MEMBER"] as OutreachRole[])("%s can read", (role) =>
    expect(canOutreach(role, "READ")).toBe(true),
  );
});
