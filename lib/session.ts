import "server-only";
import { UserRole } from "@prisma/client";
import { auth } from "@/lib/auth";
import { AuthorizationError, assertRole } from "@/lib/rbac";

/**
 * Server-side session & tenant helpers.
 *
 * This is the single entry point every server component, server action and
 * route handler must use to learn *who* is calling and *which tenant* they
 * belong to. Domain services never read the session themselves — they receive
 * an already-resolved `organizationId` (see `lib/tenant.ts`).
 *
 * SECURITY CONTRACT
 * -----------------
 * The objects returned here contain no secret material: no `passwordHash`,
 * no `AUTH_SECRET`, no `DATABASE_URL`. They are safe to pass as props from a
 * server component into a client component.
 */

/** The authenticated principal, as exposed to application code. */
export interface CurrentUser {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  role: UserRole;
  /** Tenant the user belongs to. `null` only for malformed/legacy sessions. */
  organizationId: string | null;
}

/**
 * The current user, or `null` when there is no authenticated session.
 * Never throws — use `requireUser()` when authentication is mandatory.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
    role: user.role ?? UserRole.MEMBER,
    organizationId: user.organizationId ?? null,
  };
}

/**
 * The current tenant id (`organizationId`), or `null` when unauthenticated or
 * when the session carries no tenant. Never throws — use
 * `requireOrganization()` when the tenant is mandatory (it always is for
 * domain queries).
 */
export async function getCurrentOrganization(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.organizationId ?? null;
}

/**
 * Assert an authenticated session and return the current user.
 * @throws {AuthorizationError} 401 when unauthenticated.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthorizationError("Unauthorized: authentication required.", 401);
  }
  return user;
}

/**
 * Assert an authenticated session bound to a tenant and return its
 * `organizationId`. This is the value that must be injected into every
 * domain query's `where` clause.
 *
 * @throws {AuthorizationError} 401 unauthenticated · 403 session without tenant.
 */
export async function requireOrganization(): Promise<string> {
  const user = await requireUser();
  if (!user.organizationId) {
    throw new AuthorizationError("Forbidden: session is not bound to an organization.", 403);
  }
  return user.organizationId;
}

/**
 * Assert an authenticated session whose role meets or exceeds `required`
 * (ADMIN > MANAGER > MEMBER) and that is bound to a tenant.
 *
 * @throws {AuthorizationError} 401 unauthenticated · 403 insufficient role / no tenant.
 */
export async function requireRole(
  required: UserRole,
): Promise<CurrentUser & { organizationId: string }> {
  const user = await requireUser();
  assertRole(user.role, required);
  if (!user.organizationId) {
    throw new AuthorizationError("Forbidden: session is not bound to an organization.", 403);
  }
  return { ...user, organizationId: user.organizationId };
}

/** Guard for ADMIN-only server actions / route handlers. */
export async function requireAdmin() {
  return requireRole(UserRole.ADMIN);
}

/** Guard for MANAGER-or-above server actions / route handlers. */
export async function requireManager() {
  return requireRole(UserRole.MANAGER);
}
