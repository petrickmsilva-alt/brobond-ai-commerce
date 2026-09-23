import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { createTenantAwareAdapter } from "@/lib/auth-adapter";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { equalizeVerificationTiming, verifyPassword } from "@/lib/password";
import { credentialsSchema } from "@/lib/validations/auth";
import { isGoogleProviderConfigured, resolveGoogleCredentials } from "@/lib/auth-providers";
import { resolveTrustHost } from "@/lib/auth-trust-host";

/**
 * NextAuth v5 configuration.
 *
 * PR000.2 wired a **Credentials provider** (email + password) on top of the
 * Prisma adapter and JWT sessions. PR010.4 keeps every one of those mechanics
 * and changes exactly one policy.
 *
 * WHAT PR010.4 CHANGES
 * --------------------
 * The "no public sign-up" rule is retired. `/signup` provisions a tenant and
 * signs the user in, and a first-time Google user is provisioned by the
 * tenant-aware adapter (`lib/auth-adapter.ts`) at the moment NextAuth asks for
 * a user. The `signIn` callback therefore no longer refuses unknown federated
 * emails — refusing them is what made "primeiro acesso com Google"
 * impossible.
 *
 * NOTHING ELSE MOVED: same providers, same JWT strategy, same callbacks, same
 * cookie names. NextAuth is configured, never bypassed.
 *
 * SECURITY CONTRACT
 * -----------------
 * - A new account, by either route, gets a BRAND-NEW EMPTY organization of
 *   which it is the sole member. Signing up can never grant any authority
 *   inside an existing workspace; joining one still requires an invitation.
 * - `authorize()` only authenticates users that exist AND have a
 *   `passwordHash`, so a Google-only account cannot be password-guessed.
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
 * Federated providers, registered ONLY when fully provisioned (PR010.2 §4 ·
 * PR010.3 §5/§12 · PR010.4 §5).
 *
 * An unconfigured Google provider is absent from this array, so
 * `/api/auth/signin/google` legitimately 404s and the UI — reading the same
 * `isGoogleProviderConfigured()` predicate — hides the button instead of
 * rendering a dead, disabled control. The two can never disagree.
 *
 * PR010.3 §12 accepts two env conventions for the same credentials:
 * `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (NextAuth native) and
 * `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. `resolveGoogleCredentials()`
 * owns the resolution, so the provider is registered with whichever complete
 * pair the deployment provides.
 *
 * PR010.4 §5: a Google sign-in from an unknown email now CREATES the account
 * (Organization + ADMIN User + Workspace) through the tenant-aware adapter,
 * instead of being refused. A known email signs in normally, into the tenant
 * and with the role it already has.
 */
const googleCredentials = resolveGoogleCredentials();
const federatedProviders =
  isGoogleProviderConfigured() && googleCredentials
    ? [
        Google({
          clientId: googleCredentials.clientId,
          clientSecret: googleCredentials.clientSecret,
          allowDangerousEmailAccountLinking: false,
        }),
      ]
    : [];

export const authConfig = {
  /**
   * HOST TRUST (production incident fix).
   *
   * Render/Docker terminate TLS in front of the Node process, so every request
   * arrives with the public host in `X-Forwarded-Host` instead of `Host`.
   * Auth.js refuses to use a forwarded host unless it is told the proxy is
   * trusted, which is what produced, on every `/api/auth/session` call:
   *
   *   [auth][error] UntrustedHost: Host must be trusted.
   *   URL was: https://brobond-ai-commerce.onrender.com/api/auth/session
   *
   * The policy lives in `lib/auth-trust-host.ts`: trusted by default, with
   * `AUTH_TRUST_HOST=false` as an explicit opt-out. Asserting it here means
   * sign-in no longer depends on one dashboard variable surviving every
   * future deploy.
   */
  trustHost: resolveTrustHost(),
  // PR010.4 §5 — wraps `createUser` so a first-time federated user is
  // provisioned with a tenant. Every other method is the stock Prisma adapter.
  adapter: createTenantAwareAdapter(),
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
     * Gate for federated sign-in (PR010.2 §4 · rewritten in PR010.4 §5).
     *
     * WHAT THIS USED TO DO
     * --------------------
     * It looked the email up and returned `false` when no `User` existed, so
     * that Google could authenticate an identity but never create one. That
     * was the right call while there was no public sign-up — and it is exactly
     * what §5 of this PR asks us to remove: "Se usuário não existir: criar
     * automaticamente".
     *
     * WHAT IT DOES NOW
     * ----------------
     * It allows the sign-in and lets the flow continue. NextAuth resolves an
     * existing account through the adapter (`getUserByEmail`) and signs them
     * into their own tenant with their own role; an unknown email reaches
     * `createUser`, where `lib/auth-adapter.ts` provisions Organization +
     * ADMIN User + Workspace atomically. Either way the user that comes out
     * the other side is tenant-bound, which is the invariant that actually
     * matters.
     *
     * An identity with no email is still refused: it could never be bound to
     * a tenant, recovered, or invited to anything.
     */
    async signIn({ user, account }) {
      if (!account || account.provider === "credentials") return true;

      const email = user?.email?.trim().toLowerCase();
      return Boolean(email);
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
  resolveGoogleCredentials,
  showGoogleProvider,
} from "@/lib/auth-providers";
