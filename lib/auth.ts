import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { equalizeVerificationTiming, verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validations/auth";

/**
 * NextAuth v5 configuration.
 *
 * PR000.2 wires a **Credentials provider** (email + password) on top of the
 * Prisma adapter and JWT sessions.
 *
 * SECURITY CONTRACT
 * -----------------
 * - There is **no public sign-up**. `authorize()` only authenticates users that
 *   already exist AND already have a `passwordHash`. Accounts are provisioned
 *   out-of-band (seed / admin tooling) — see `prisma/seed.ts`.
 * - Passwords are compared against a bcrypt digest; plaintext is never stored.
 * - `passwordHash`, `AUTH_SECRET` and `DATABASE_URL` are never returned from
 *   `authorize()`, never placed on the JWT, and never exposed on the session,
 *   so they can never reach a client component.
 * - Every authenticated user carries a required `organizationId` (tenant),
 *   enforced by the database schema and mirrored on the JWT/session.
 */

/** Shape put on the JWT / session — deliberately free of any secret material. */
interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: UserRole;
  organizationId: string;
}

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      id: "credentials",
      name: "Email e senha",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      /**
       * Returns the authenticated user, or `null` for any failure.
       *
       * Failures are intentionally indistinguishable (same `null`, comparable
       * timing) to avoid leaking whether an email exists.
       */
      async authorize(credentials): Promise<AuthenticatedUser | null> {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await prisma.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            organizationId: true,
            passwordHash: true,
          },
        });

        // Unknown account, or account without a password (e.g. OAuth-only).
        if (!user?.passwordHash) {
          await equalizeVerificationTiming(password);
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        // NOTE: `passwordHash` is deliberately dropped here — it must never
        // travel to the JWT, the session, or a client component.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    // Route-level guard used by the middleware/`auth` helper.
    authorized({ auth }) {
      return !!auth?.user;
    },
    // Persist role + organization on the JWT so RBAC/tenant checks avoid a DB hit.
    async jwt({ token, user, trigger }) {
      if (user) {
        token.role = (user as Partial<AuthenticatedUser>).role ?? UserRole.MEMBER;
        token.organizationId = (user as Partial<AuthenticatedUser>).organizationId ?? null;
        return token;
      }

      // Refresh tenant/role from the database when the claim is missing
      // (e.g. a token minted before this hardening) or on explicit update.
      if (token.sub && (trigger === "update" || !token.organizationId)) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, organizationId: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.organizationId = fresh.organizationId;
        }
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
// RBAC re-exports
// ------------------------------------------------------------------
// The pure role logic lives in `lib/rbac.ts` (no NextAuth/Prisma runtime
// dependency, unit-testable). Session-aware guards — `requireUser`,
// `requireRole`, `requireAdmin`, `requireManager`, `requireOrganization` —
// live in `lib/session.ts`.
export {
  AuthorizationError,
  ROLE_HIERARCHY,
  ROLE_RANK,
  assertRole,
  hasRole,
  isAdmin,
  isManager,
} from "@/lib/rbac";
