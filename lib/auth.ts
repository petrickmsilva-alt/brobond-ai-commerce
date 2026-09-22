import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";

/**
 * NextAuth v5 configuration.
 *
 * PR000.1 ships the multi-tenant architecture and a Prisma-backed adapter,
 * plus an initial RBAC layer. Concrete providers (OAuth / credentials) are
 * intentionally left as an empty array to be wired up in a later PR — the
 * surface is ready.
 */
export const authConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    // Providers are configured in a later PR (e.g. GitHub, Google, Credentials).
    // The adapter + session wiring below is production-ready.
  ],
  callbacks: {
    // Route-level guard used by the middleware/`auth` helper.
    authorized({ auth }) {
      return !!auth?.user;
    },
    // Persist role + organization on the JWT so RBAC checks don't need a DB hit.
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: UserRole }).role ?? UserRole.MEMBER;
        token.organizationId = (user as { organizationId?: string | null }).organizationId ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        if (token?.sub) session.user.id = token.sub;
        session.user.role = (token.role as UserRole) ?? UserRole.MEMBER;
        session.user.organizationId = (token.organizationId as string | null) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

// ------------------------------------------------------------------
// Initial RBAC (Role-Based Access Control)
// ------------------------------------------------------------------

/**
 * Role privilege ordering. Higher number = more privileges.
 */
const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.ADMIN]: 3,
  [UserRole.MANAGER]: 2,
  [UserRole.MEMBER]: 1,
};

/** Whether a role meets or exceeds a required role. */
export function hasRole(role: UserRole | undefined, required: UserRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

/** Whether a role is ADMIN. */
export function isAdmin(role: UserRole | undefined): boolean {
  return role === UserRole.ADMIN;
}

/**
 * Assert the current session belongs to an ADMIN, throwing otherwise.
 * Use at the top of admin-only server actions / route handlers.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user.role)) {
    throw new Error("Forbidden: ADMIN role required.");
  }
  return session;
}
