import "server-only";

import type { PrismaClient, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { logSignupEvent } from "@/modules/auth/signup-logging";
import type { SignupData } from "@/lib/validations/auth";
import { OUTREACH_TEMPLATES } from "@/modules/outreach/prompts/templates";
import {
  DEFAULT_TENANT_SETTINGS,
  defaultCompanyFromEmail,
  defaultWorkspaceName,
  displayNameFromEmail,
  resolveTenantSlug,
} from "./tenant-provisioning";

/**
 * Self-signup & first tenant setup (PR010.4 §4 · §5).
 *
 * WHAT THIS REPLACES
 * ------------------
 * Every PR from 000.2 through 010.3 carried the same sentence: "there is no
 * public sign-up". Accounts came from the seed or from an ADMIN's invitation,
 * and a stranger's only affordance was a form that queued a lead. PR010.4
 * retires that contract deliberately: `register()` below is the official
 * onboarding, and it provisions a complete, usable tenant in one transaction.
 *
 * WHAT IT CREATES, IN ONE TRANSACTION
 * -----------------------------------
 *   1. `Organization`  — the tenant, with a globally unique slug
 *   2. `User`          — role ADMIN, bcrypt hash, bound to that tenant
 *   3. Workspace       — the display name + default currency/locale/timezone
 *   4. Seed inicial    — the outreach message templates a workspace needs to
 *                        be functional on day one
 *
 * All four succeed or none do. A half-provisioned tenant (an organization
 * with no admin, or an admin with no templates) is the one outcome this
 * service must never produce, because nobody would be able to fix it from
 * inside the product.
 *
 * SECURITY CONTRACT
 * -----------------
 * - The ROLE IS NOT AN INPUT. `UserRole.ADMIN` is written here, server-side,
 *   and only because the user is creating a brand-new, empty tenant of which
 *   they are the sole member. There is no payload field a client could use to
 *   ask for a role; joining an EXISTING workspace still goes through an
 *   invitation, where an ADMIN picks the role.
 * - Passwords are bcrypt-hashed (cost 12) before they reach the database and
 *   the plaintext is never persisted, logged or returned.
 * - Email uniqueness is enforced twice: a pre-check that yields the friendly
 *   "email já utilizado" field error (§8), and the database's unique index,
 *   which is what actually decides the race between two simultaneous signups.
 * - The returned value carries no `passwordHash` and no token, so it is safe
 *   for a server action to hand back to the caller.
 */

export type SignupDatabase = Pick<
  PrismaClient,
  "organization" | "user" | "messageTemplate" | "account"
> & {
  $transaction: PrismaClient["$transaction"];
};

/** Why a signup was refused. Mapped to a FIELD by the server action (§8). */
export type SignupErrorCode = "EMAIL_TAKEN";

/** Runtime-safe enum value; the generated Prisma enum is only needed as a type. */
const ADMIN_ROLE = "ADMIN" as UserRole;

export class SignupError extends Error {
  readonly code: SignupErrorCode;
  /** The form field this error belongs under. Never a generic banner. */
  readonly field: string;

  constructor(code: SignupErrorCode, field: string, message: string) {
    super(message);
    this.name = "SignupError";
    this.code = code;
    this.field = field;
  }
}

/** Non-secret result of a successful signup. */
export interface SignupResult {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
  organizationId: string;
  organizationSlug: string;
  workspaceName: string;
}

/** Everything `provision()` needs, however the identity was proven. */
export interface ProvisionTenantInput {
  email: string;
  name: string | null;
  company: string;
  whatsapp: string | null;
  /** Already-hashed password, or `null` for a federated (Google) account. */
  passwordHash: string | null;
  /** Profile picture from the identity provider, when there is one. */
  image?: string | null;
}

/** Correlates transaction logs with the server action that initiated them. */
export interface SignupProvisionContext {
  requestId?: string;
}

export function createSignupService(db: SignupDatabase) {
  /**
   * Seed the records a brand-new workspace needs to be immediately usable.
   *
   * Deliberately small: the outreach templates (which every message-generation
   * path reads and which would otherwise 404 the AI workbench on day one).
   * It creates NO fake products, creators, campaigns or sales — a first-run
   * dashboard showing invented numbers is worse than an empty one, and §9's
   * onboarding checklist is what fills that silence instead.
   */
  async function seedWorkspace(
    tx: Pick<SignupDatabase, "messageTemplate">,
    organizationId: string,
  ): Promise<number> {
    await tx.messageTemplate.createMany({
      data: OUTREACH_TEMPLATES.map((template) => ({
        organizationId,
        name: template.name,
        type: template.type,
        content: template.content,
      })),
      skipDuplicates: true,
    });
    return OUTREACH_TEMPLATES.length;
  }

  /**
   * Create Organization + ADMIN User + workspace defaults + seed, atomically.
   *
   * Shared by the credentials signup (`register()`) and the Google
   * first-access path (§5), so the two can never drift into provisioning
   * subtly different tenants.
   */
  async function provision(
    input: ProvisionTenantInput,
    context: SignupProvisionContext = {},
  ): Promise<SignupResult> {
    const email = input.email.trim().toLowerCase();
    const workspaceName = defaultWorkspaceName(input.company);
    const requestId = context.requestId ?? `signup-${Date.now().toString(36)}`;

    /**
     * The reads that decide whether a User/slug already exists run IN the same
     * interactive transaction as all writes. The database unique indexes still
     * own concurrent races, but no ordinary failure can leave an orphaned
     * Organization behind.
     *
     * Workspace and settings are persisted on Organization in this schema;
     * writing them as explicit consecutive steps makes the provisioning order
     * observable and preserves the requested invariant:
     * Organization → User → Workspace → Settings.
     */
    return db.$transaction(async (tx) => {
      // Friendly duplicate pre-check. The `User.email` unique index is still
      // the final authority for two submissions arriving at the same instant.
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        throw new SignupError("EMAIL_TAKEN", "email", "Este email já possui uma conta.");
      }

      const slug = await resolveTenantSlug(input.company, async (candidate) => {
        const taken = await tx.organization.findUnique({
          where: { slug: candidate },
          select: { id: true },
        });
        return Boolean(taken);
      });

      // 1. Organization ---------------------------------------------------
      const organization = await tx.organization.create({
        data: {
          name: input.company,
          slug,
          whatsapp: input.whatsapp,
          selfServe: true,
        },
      });
      logSignupEvent("ORG_CREATED", { requestId, organizationId: organization.id });

      // 2. User -----------------------------------------------------------
      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          image: input.image ?? null,
          // The first user of a brand-new tenant is always its ADMIN.
          role: ADMIN_ROLE,
          passwordHash: input.passwordHash,
          organizationId: organization.id,
        },
        select: { id: true, email: true, name: true, role: true, organizationId: true },
      });
      logSignupEvent("USER_CREATED", {
        requestId,
        organizationId: organization.id,
        userId: user.id,
      });

      // 3. Workspace ------------------------------------------------------
      await tx.organization.update({
        where: { id: organization.id },
        data: { workspaceName },
      });
      logSignupEvent("WORKSPACE_CREATED", {
        requestId,
        organizationId: organization.id,
        userId: user.id,
      });

      // 4. Settings -------------------------------------------------------
      await tx.organization.update({
        where: { id: organization.id },
        data: {
          currency: DEFAULT_TENANT_SETTINGS.currency,
          locale: DEFAULT_TENANT_SETTINGS.locale,
          timezone: DEFAULT_TENANT_SETTINGS.timezone,
        },
      });
      logSignupEvent("SETTINGS_CREATED", {
        requestId,
        organizationId: organization.id,
        userId: user.id,
      });

      // A functional empty workspace also receives its server-side templates.
      await seedWorkspace(tx, organization.id);

      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: organization.id,
        organizationSlug: organization.slug,
        workspaceName,
      };
    });
  }

  return {
    seedWorkspace,
    provision,

    /**
     * The credentials signup behind `/signup` (§4).
     *
     * Takes the already-validated payload (the server action parses it with
     * `signupSchema` first), hashes the password and provisions the tenant.
     */
    async register(data: SignupData, context: SignupProvisionContext = {}): Promise<SignupResult> {
      const passwordHash = await hashPassword(data.password);

      return provision(
        {
          email: data.email,
          name: data.name,
          company: data.company,
          whatsapp: data.whatsapp,
          passwordHash,
        },
        context,
      );
    },

    /**
     * Google first access (§5).
     *
     * "Se usuário não existir: criar automaticamente Organization + User ADMIN
     * + Workspace. Se existir: entrar normalmente."
     *
     * Returns the existing user untouched when there is one — a returning
     * Google user must never get a second tenant, and their role must never be
     * re-elevated to ADMIN by logging in.
     *
     * The company name is inferred (their email domain, falling back to their
     * own name) because Google never asked them for one. It is a placeholder
     * they can rename in Configurações, not a guess presented as fact.
     */
    async ensureFederatedTenant(profile: {
      email: string;
      name?: string | null;
      image?: string | null;
    }): Promise<{ result: SignupResult; created: boolean }> {
      const email = profile.email.trim().toLowerCase();

      const existing = await db.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          organizationId: true,
          organization: { select: { slug: true, name: true, workspaceName: true } },
        },
      });

      if (existing) {
        return {
          created: false,
          result: {
            userId: existing.id,
            email: existing.email,
            name: existing.name,
            role: existing.role,
            organizationId: existing.organizationId,
            organizationSlug: existing.organization?.slug ?? "",
            workspaceName:
              existing.organization?.workspaceName ?? existing.organization?.name ?? "Workspace",
          },
        };
      }

      const name = profile.name?.trim() || displayNameFromEmail(email);

      const result = await provision({
        email,
        name,
        company: defaultCompanyFromEmail(email, name),
        // Google never asked for a phone number, and inventing one would be
        // worse than leaving the field honestly empty.
        whatsapp: null,
        // Federated account: no password exists, so credentials login stays
        // disabled for it until the user sets one via "esqueci minha senha".
        passwordHash: null,
        image: profile.image ?? null,
      });

      return { result, created: true };
    },
  };
}

export type SignupService = ReturnType<typeof createSignupService>;

/** Production instance bound to the shared Prisma client. */
export const signupService = createSignupService(prisma);
