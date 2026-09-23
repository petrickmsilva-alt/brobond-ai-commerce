/**
 * Auth domain barrel (PR010.2 · PR010.3).
 *
 * Groups the flows introduced by "Enterprise Authentication & UX" and
 * "Complete Auth Flow": access requests (§5), password reset (§6) and
 * invitations (§7), plus the PR010.3 additions — the approval orchestration
 * that turns an approved request into a delivered invitation (§2) and the
 * `InvitationMailer` seam with its `ConsoleMailer` implementation (§9). Each
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
  createApprovalService,
  approvalService,
  type ApprovalDatabase,
  type ApprovalErrorCode,
  type ApprovalResult,
  type ApprovalService,
  type DeliverInvitationInput,
  type DeliveryResult,
  type RejectionResult,
} from "./approval.service";

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
