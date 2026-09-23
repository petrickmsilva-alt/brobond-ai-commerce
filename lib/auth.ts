import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { equalizeVerificationTiming, verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validations/auth";
import { isGoogleProviderConfigured } from "@/lib/auth-providers";

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

/**
 * Federated providers, registered ONLY when fully provisioned (PR010.2 §4).
 *
 * An unconfigured Google provider is absent from this array, so
 * `/api/auth/signin/google` legitimately 404s and the UI — reading the same
 * `isGoogleProviderConfigured()` predicate — hides the button instead of
 * rendering a dead, disabled control. The two can never disagree.
 *
 * NOTE: registering Google does NOT open public sign-up. The `signIn`
 * callback below still requires a pre-provisioned account.
 */
const federatedProviders = isGoogleProviderConfigured()
  ? [
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: false,
      }),
    ]
  : [];

export const authConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    ...federatedProviders,
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
    /**
     * Gate for federated sign-in (PR010.2 §4).
     *
     * SECURITY: Google authenticates an identity; it does NOT create one.
     * A Google login is accepted only when a `User` with that email already
     * exists — provisioned by the seed, by an ADMIN, or by accepting an
     * `Invitation`. This keeps the PR000.2 "no public sign-up" contract
     * intact now that an OAuth provider can be registered: without it,
     * anyone with a Google account could mint a tenant-less user.
     *
     * Credentials sign-in is unchanged — `authorize()` already proved the
     * account exists and the password matched.
     */
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") return true;

      const email = user?.email?.trim().toLowerCase();
      if (!email) return false;

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, organizationId: true },
      });

      // Unknown email, or an account not bound to a tenant → refuse.
      return Boolean(existing?.organizationId);
    },
    // Persist role + organization on the JWT so RBAC/tenant checks avoid a DB hit.
    async jwt({ token, user, trigger }) {
      if (user) {
        const claims = user as Partial<AuthenticatedUser>;
        token.role = claims.role ?? UserRole.MEMBER;
        token.organizationId = claims.organizationId ?? null;

        // A federated profile (PR010.2 §4) carries no role/tenant — those
        // live only in our database. Resolve them now so the very first
        // token minted by a Google sign-in is already tenant-bound, exactly
        // like a credentials one. `signIn()` has already proven the account
        // exists, so this lookup always hits.
        if (!token.organizationId && token.sub) {
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

// ------------------------------------------------------------------
// Provider availability re-exports (PR010.2 §4)
// ------------------------------------------------------------------
// Re-exported from the pure `lib/auth-providers.ts` so a caller that already
// imports the auth domain does not need a second import. Both return plain
// booleans — no client id, no secret.
export {
  getAvailableProviders,
  isGoogleProviderConfigured,
  showGoogleProvider,
} from "@/lib/auth-providers";
