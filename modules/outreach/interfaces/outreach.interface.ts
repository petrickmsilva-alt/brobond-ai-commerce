/** Client-safe Outreach AI contracts. No provider or social-network SDK is used. */
export const OUTREACH_STATUSES = [
  "DRAFT",
  "READY",
  "SCHEDULED",
  "SENT",
  "FAILED",
  "CANCELLED",
] as const;

export type OutreachStatusName = (typeof OUTREACH_STATUSES)[number];

export const TEMPLATE_TYPES = [
  "FIRST_CONTACT",
  "FOLLOW_UP",
  "NEGOTIATION",
  "REENGAGEMENT",
] as const;

export type TemplateTypeName = (typeof TEMPLATE_TYPES)[number];

export interface OutreachCreatorContext {
  displayName: string;
  niche: string;
}

export interface OutreachProductContext {
  name: string;
}

export interface OutreachCampaignContext {
  name: string;
}

export interface OutreachTrendContext {
  keyword: string;
}

export interface GenerateOutreachInput {
  creator: OutreachCreatorContext;
  product: OutreachProductContext;
  campaign: OutreachCampaignContext;
  trend: OutreachTrendContext;
  /** A persisted template may be supplied; otherwise the default first-contact template is used. */
  template?: string;
}

export type OutreachRole = "ADMIN" | "MANAGER" | "MEMBER";
export type OutreachPermission =
  | "READ"
  | "GENERATE"
  | "EDIT_MESSAGE"
  | "SCHEDULE"
  | "CANCEL"
  | "CREATE_TEMPLATE"
  | "EDIT_TEMPLATE";

const PERMISSIONS: Record<OutreachRole, readonly OutreachPermission[]> = {
  ADMIN: [
    "READ",
    "GENERATE",
    "EDIT_MESSAGE",
    "SCHEDULE",
    "CANCEL",
    "CREATE_TEMPLATE",
    "EDIT_TEMPLATE",
  ],
  MANAGER: ["READ", "GENERATE", "EDIT_MESSAGE", "SCHEDULE"],
  MEMBER: ["READ"],
};

export function canOutreach(role: OutreachRole, permission: OutreachPermission): boolean {
  return PERMISSIONS[role].includes(permission);
}

export interface OutreachActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}
