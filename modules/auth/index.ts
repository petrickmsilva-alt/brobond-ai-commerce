/**
 * Auth domain barrel (PR010.2).
 *
 * Groups the three flows introduced by "Enterprise Authentication & UX":
 * access requests (§5), password reset (§6) and invitations (§7). Each
 * service is created through a `create*Service(db)` factory so tests can
 * inject an in-memory database, exactly like the connectors and delivery
 * modules do.
 *
 * Everything here is `server-only`: these modules touch Prisma and bcrypt and
 * must never be pulled into a client bundle.
 */

export {
  createAccessRequestService,
  accessRequestService,
  type AccessRequestCounts,
  type AccessRequestDatabase,
  type AccessRequestService,
  type AccessRequestView,
} from "./access-request.service";

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
  createPasswordResetService,
  passwordResetService,
  PasswordResetError,
  RESET_TTL_MINUTES,
  type PasswordResetDatabase,
  type PasswordResetRejection,
  type PasswordResetRequestResult,
  type PasswordResetService,
} from "./password-reset.service";
