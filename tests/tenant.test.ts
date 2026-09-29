import { describe, expect, it } from "vitest";
import { AuthorizationError } from "@/lib/rbac";
import { assertOrganizationId, assertSameTenant, scopedWhere, tenantWhere } from "@/lib/tenant";

const ORG_A = "org_aaaaaaaaaaaaaaaaaaaa";
const ORG_B = "org_bbbbbbbbbbbbbbbbbbbb";

describe("assertOrganizationId()", () => {
  it("returns the id when present", () => {
    expect(assertOrganizationId(ORG_A)).toBe(ORG_A);
  });

  it("throws 403 for null / undefined / blank", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(() => assertOrganizationId(value)).toThrow(AuthorizationError);
      try {
        assertOrganizationId(value);
      } catch (error) {
        expect((error as AuthorizationError).status).toBe(403);
      }
    }
  });
});

describe("tenantWhere()", () => {
  it("builds the canonical `where: { organizationId }` fragment", () => {
    expect(tenantWhere(ORG_A)).toEqual({ organizationId: ORG_A });
  });

  it("refuses to build an unscoped query", () => {
    expect(() => tenantWhere(null)).toThrow(AuthorizationError);
    expect(() => tenantWhere(undefined)).toThrow(AuthorizationError);
  });
});

describe("scopedWhere()", () => {
  it("merges the tenant scope into a caller filter", () => {
    expect(scopedWhere(ORG_A, { status: "ACTIVE" })).toEqual({
      status: "ACTIVE",
      organizationId: ORG_A,
    });
  });

  it("works with no caller filter", () => {
    expect(scopedWhere(ORG_A)).toEqual({ organizationId: ORG_A });
  });

  it("cannot be overridden by a caller-supplied organizationId (scope wins)", () => {
    const hostile = scopedWhere(ORG_A, { organizationId: ORG_B });
    expect(hostile.organizationId).toBe(ORG_A);
  });

  it("refuses to build an unscoped query", () => {
    expect(() => scopedWhere(null, { status: "ACTIVE" })).toThrow(AuthorizationError);
  });
});

describe("assertSameTenant() — cross-tenant isolation", () => {
  const recordA = { id: "p1", slug: "hoodie", organizationId: ORG_A };
  const recordB = { id: "p2", slug: "hoodie-b", organizationId: ORG_B };

  it("returns the record when it belongs to the caller's tenant", () => {
    expect(assertSameTenant(recordA, ORG_A)).toBe(recordA);
  });

  it("returns null for a record owned by another tenant (no leak)", () => {
    expect(assertSameTenant(recordB, ORG_A)).toBeNull();
    expect(assertSameTenant(recordA, ORG_B)).toBeNull();
  });

  it("returns null for a missing record", () => {
    expect(assertSameTenant(null, ORG_A)).toBeNull();
  });

  it("throws 403 when the caller has no tenant scope at all", () => {
    expect(() => assertSameTenant(recordA, null)).toThrow(AuthorizationError);
  });
});

describe("tenant isolation end-to-end shape", () => {
  /**
   * Simulates the mandatory service pattern:
   *   where: { organizationId: currentOrganizationId }
   * A fake datastore proves rows from another tenant are never returned.
   */
  const rows = [
    { id: "1", name: "A-1", organizationId: ORG_A },
    { id: "2", name: "A-2", organizationId: ORG_A },
    { id: "3", name: "B-1", organizationId: ORG_B },
  ];

  function findMany(where: { organizationId: string }) {
    return rows.filter((row) => row.organizationId === where.organizationId);
  }

  it("only returns rows of the current organization", () => {
    expect(findMany(tenantWhere(ORG_A)).map((r) => r.id)).toEqual(["1", "2"]);
    expect(findMany(tenantWhere(ORG_B)).map((r) => r.id)).toEqual(["3"]);
  });

  it("never returns another tenant's rows when combined with a filter", () => {
    const result = findMany(scopedWhere(ORG_B, { organizationId: ORG_A }));
    expect(result.every((row) => row.organizationId === ORG_B)).toBe(true);
    expect(result.map((r) => r.id)).toEqual(["3"]);
  });
});
