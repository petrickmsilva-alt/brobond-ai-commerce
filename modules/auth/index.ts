/**
 * Auth domain barrel (PR010.2 · PR010.3 · PR010.4).
 *
 * PR010.4 reshapes this domain. The access-request queue and the approval
 * orchestration that fed it are GONE — `/signup` now provisions a whole
 * tenant, so there are no leads to review. What remains, plus what replaces
 * them:
 *
 *   - `signup.service`              — Organization + ADMIN User + Workspace
 *                                     + seed, in one transaction (§4/§5)
 *   - `onboarding.service`          — the derived first-run checklist (§9)
 *   - `tenant-provisioning`         — the pure rules behind both (slugs,
 *                                     defaults, checklist derivation)
 *   - `invitation.service`          — adding teammates to an EXISTING
 *                                     workspace (no longer mandatory)
 *   - `invitation-delivery.service` — mailing an invite link
 *   - `password-reset.service`      — §6, unchanged
 *
 * Each service is created through a `create*Service(db)` factory so tests can
 * inject an in-memory database, exactly like the connectors and delivery
 * modules do.
 *
 * Everything server-side here is `server-only`: these modules touch Prisma and
 * bcrypt and must never be pulled into a client bundle. The one exception is
 * `tenant-provisioning`, which is pure and safe anywhere.
 */

export {
  createSignupService,
  signupService,
  SignupError,
  type ProvisionTenantInput,
  type SignupDatabase,
  type SignupErrorCode,
  type SignupResult,
  type SignupService,
} from "./signup.service";

export {
  createOnboardingService,
  onboardingService,
  type OnboardingDatabase,
  type OnboardingService,
  type OnboardingState,
  type OnboardingStepView,
} from "./onboarding.service";

export {
  DEFAULT_TENANT_SETTINGS,
  FREEMAIL_DOMAINS,
  ONBOARDING_STEPS,
  RESERVED_SLUGS,
  TENANT_SLUG_FALLBACK,
  TENANT_SLUG_MAX_LENGTH,
  countCompletedSteps,
  defaultCompanyFromEmail,
  defaultWorkspaceName,
  deriveOnboardingProgress,
  displayNameFromEmail,
  isOnboardingComplete,
  resolveTenantSlug,
  tenantSlugBase,
  type OnboardingCounters,
  type OnboardingProgress,
  type OnboardingStepId,
  type TenantSettings,
} from "./tenant-provisioning";

export {
  createInvitationDeliveryService,
  invitationDeliveryService,
  type DeliverInvitationInput,
  type DeliveryResult,
  type InvitationDeliveryDatabase,
  type InvitationDeliveryService,
} from "./invitation-delivery.service";

export {
  createInvitationService,
  invitationService,
  InvitationError,
  type CreateInvitationArgs,
  type InvitationDatabase,
  type InvitationPreview,
  type InvitationRejection,
  type InvitationService,
  type InvitationView,
} from "./invitation.service";

export {
  ConsoleMailer,
  createInvitationMailer,
  formatInvitationEmail,
  type InvitationEmailPayload,
  type InvitationMailer,
  type MailerEnv,
  type MailerProvider,
  type RenderedInvitationEmail,
} from "./invitation-mailer";

export {
  createPasswordResetService,
  passwordResetService,
  PasswordResetError,
  RESET_TTL_MINUTES,
  type PasswordResetDatabase,
  type PasswordResetRejection,
  type PasswordResetRequestResult,
  type PasswordResetService,
} from "./password-reset.service";
