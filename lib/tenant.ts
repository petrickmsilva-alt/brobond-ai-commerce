import { AuthorizationError } from "@/lib/rbac";

/**
 * Tenant isolation primitives.
 *
 * MANDATORY PATTERN
 * -----------------
 * No domain service may run a query without an organization scope. Every
 * service function takes the tenant id as its first argument and builds its
 * `where` clause through these helpers:
 *
 * ```ts
 * // route / server action  ──────────────────────────────────────────────
 * const organizationId = await requireOrganization();   // lib/session.ts
 * const products = await productsService.list(organizationId);
 *
 * // service  ─────────────────────────────────────────────────────────────
 * list(organizationId: string) {
 *   return prisma.product.findMany({ where: tenantWhere(organizationId) });
 * }
 * // → where: { organizationId: currentOrganizationId }
 * ```
 *
 * These helpers are pure (no session, no Prisma import) so they stay
 * unit-testable and usable from any runtime.
 */

/** A `where` fragment scoped to exactly one tenant. */
export interface TenantScope {
  organizationId: string;
}

/**
 * Validate a tenant id coming from the session layer.
 * @throws {AuthorizationError} 403 when the id is missing or blank.
 */
export function assertOrganizationId(organizationId: string | null | undefined): string {
  if (typeof organizationId !== "string" || organizationId.trim() === "") {
    throw new AuthorizationError("Forbidden: organization scope is required.", 403);
  }
  return organizationId;
}

/**
 * Build the canonical tenant `where` fragment.
 *
 * ```ts
 * where: {
 *   organizationId: currentOrganizationId
 * }
 * ```
 *
 * @throws {AuthorizationError} 403 when no tenant is provided.
 */
export function tenantWhere(organizationId: string | null | undefined): TenantScope {
  return { organizationId: assertOrganizationId(organizationId) };
}

/**
 * Merge a tenant scope into an arbitrary `where` object.
 *
 * The tenant clause is applied **last** so a caller-supplied filter can never
 * widen or override the isolation boundary.
 */
export function scopedWhere<T extends object>(
  organizationId: string | null | undefined,
  where?: T,
): T & TenantScope {
  return { ...(where ?? ({} as T)), ...tenantWhere(organizationId) };
}

/**
 * Assert that a record loaded by a non-tenant-scoped unique key (e.g. a global
 * `slug` or `id`) actually belongs to the caller's tenant.
 *
 * Returns `null` when the record does not exist, so callers can map it to a
 * 404 without leaking the existence of another tenant's record.
 */
export function assertSameTenant<T extends { organizationId: string }>(
  record: T | null,
  organizationId: string | null | undefined,
): T | null {
  const scope = assertOrganizationId(organizationId);
  if (!record) return null;
  if (record.organizationId !== scope) return null;
  return record;
}
