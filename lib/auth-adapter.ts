import "server-only";

import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { prisma } from "@/lib/prisma";
import { signupService } from "@/modules/auth/signup.service";

/**
 * Tenant-aware NextAuth adapter (PR010.4 §5).
 *
 * THE PROBLEM
 * -----------
 * `User.organizationId` is NOT NULL — it has been the backbone of every
 * tenant-scoped query since PR000.2. NextAuth's Prisma adapter, however,
 * creates a federated user with exactly what the provider gave it
 * (`email`, `name`, `image`, `emailVerified`). Left alone, the very first
 * Google sign-in would hit a foreign-key/NOT NULL violation and the user
 * would see an opaque `OAuthCreateAccount` error.
 *
 * PR010.2's answer was to forbid the situation: the `signIn` callback refused
 * any Google account that did not already exist. That kept the "no public
 * sign-up" contract, at the cost of §5 of this PR — "primeiro acesso" with
 * Google was impossible by construction.
 *
 * THE FIX
 * -------
 * Wrap exactly one adapter method. `createUser` no longer writes a bare user:
 * it delegates to `signupService.provision()`, which creates the Organization,
 * the ADMIN User and the workspace defaults in a single transaction — the same
 * code path `/signup` uses. Every other adapter method is the stock
 * implementation, untouched.
 *
 * WHY WRAP THE ADAPTER INSTEAD OF THE `signIn` CALLBACK
 * -----------------------------------------------------
 * `signIn` runs BEFORE `handleLoginOrRegister`. Provisioning the user there
 * would make the adapter's own `getUserByEmail` find an account with no linked
 * OAuth record, and NextAuth would correctly abort with `AccountNotLinked`.
 * Creating the user at the exact moment NextAuth asks for one keeps the
 * library's account-linking logic intact — NextAuth is not bypassed, it is
 * given a user that satisfies our schema.
 *
 * SECURITY CONTRACT
 * -----------------
 * - A federated user is created with `passwordHash: null`, so the Credentials
 *   provider still refuses them (it requires a stored digest) until they set
 *   a password through "esqueci minha senha".
 * - The new user is ADMIN of a BRAND-NEW, EMPTY organization of which they are
 *   the only member. This grants authority over nothing but their own fresh
 *   tenant — it can never elevate anyone inside an existing workspace.
 * - An email that already has an account never reaches `createUser`: NextAuth
 *   resolves it through `getUserByEmail` and signs them into their existing
 *   tenant with their existing role ("Se existir: entrar normalmente").
 */
export function createTenantAwareAdapter(): Adapter {
  const base = PrismaAdapter(prisma);

  return {
    ...base,

    async createUser(data): Promise<AdapterUser> {
      const email = data.email?.trim().toLowerCase();

      // No email means no tenant can be derived and no account can ever be
      // recovered. Refuse rather than provision something unreachable.
      if (!email) {
        throw new Error("Federated sign-in requires an email address.");
      }

      const { result } = await signupService.ensureFederatedTenant({
        email,
        name: data.name ?? null,
        image: data.image ?? null,
      });

      return {
        id: result.userId,
        email: result.email,
        name: result.name,
        image: data.image ?? null,
        // Google has already verified the address; recording that avoids a
        // pointless second verification round for a brand-new tenant owner.
        emailVerified: data.emailVerified ?? new Date(),
      } satisfies AdapterUser;
    },
  };
}
