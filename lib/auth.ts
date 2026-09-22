import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

/**
 * NextAuth v5 configuration.
 *
 * PR000 ships the architecture and a Prisma-backed adapter. Concrete
 * providers (OAuth / credentials) are intentionally left as an empty
 * array to be wired up in a later PR — the surface is ready.
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
    authorized({ auth }) {
      return !!auth?.user;
    },
    async session({ session, token }) {
      if (token?.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
