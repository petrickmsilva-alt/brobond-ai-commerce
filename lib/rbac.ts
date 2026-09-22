import { UserRole } from "@prisma/client";

/**
 * RBAC primitives — pure, dependency-free role logic.
 *
 * This module intentionally imports nothing but the Prisma enum so it can be
 * unit-tested and reused from any runtime (node, edge, tests) without pulling
 * in NextAuth, Prisma Client or database connections.
 *
 * Hierarchy: ADMIN > MANAGER > MEMBER
 */

/** Role privilege ordering. Higher number = more privileges. */
export const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.MANAGER]: 2,
  [UserRole.MEMBER]: 1,
};

/** Roles ordered from the least to the most privileged. */
export const ROLE_HIERARCHY: readonly UserRole[] = [
  UserRole.MEMBER,
  UserRole.MANAGER,
  UserRole.ADMIN,
];

/**
 * Error thrown by every `require*` guard.
 *
 * `status` mirrors the HTTP semantics so route handlers can map it directly:
 * 401 when there is no session, 403 when the session lacks privileges.
 */
export class AuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403 = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

/** Whether a role meets or exceeds a required role (hierarchical check). */
export function hasRole(role: UserRole | null | undefined, required: UserRole): boolean {
  if (!role) return false;
  const current = ROLE_RANK[role];
  const target = ROLE_RANK[required];
  if (current === undefined || target === undefined) return false;
  return current >= target;
}

/** Whether a role is exactly ADMIN. */
export function isAdmin(role: UserRole | null | undefined): boolean {
  return role === UserRole.ADMIN;
}

/** Whether a role is MANAGER or above (i.e. MANAGER or ADMIN). */
export function isManager(role: UserRole | null | undefined): boolean {
  return hasRole(role, UserRole.MANAGER);
}

/**
 * Pure assertion used by the session-aware guards in `lib/session.ts`.
 * Throws `AuthorizationError` when `role` does not satisfy `required`.
 */
export function assertRole(role: UserRole | null | undefined, required: UserRole): UserRole {
  if (!role) {
    throw new AuthorizationError("Unauthorized: authentication required.", 401);
  }
  if (!hasRole(role, required)) {
    throw new AuthorizationError(`Forbidden: ${required} role required.`, 403);
  }
  return role;
}
