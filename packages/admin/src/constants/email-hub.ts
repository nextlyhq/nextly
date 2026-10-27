/**
 * Who may see and change what in the Email hub.
 *
 * The hub reuses the permissions that guarded the email pages under Settings,
 * so no role gains or loses access by the move. Seeing a tab needs the read
 * grant or the manage grant; a change needs the grant the server checks for
 * that change, and the server refuses it without one whatever this hides.
 *
 * @module constants/email-hub
 */

import { ROUTES } from "./routes";

/** Seeing the emails a site sends, and their layouts. */
export const EMAIL_TEMPLATE_READ_PERMISSIONS = [
  "read-email-templates",
  "manage-email-templates",
] as const;

/** Creating an email. */
export const EMAIL_TEMPLATE_CREATE_PERMISSIONS = [
  "create-email-templates",
  "manage-email-templates",
] as const;

/**
 * Editing an email or a layout. `update-email-templates` is not seeded, so in
 * practice this is the manage grant; the server accepts either.
 */
export const EMAIL_TEMPLATE_UPDATE_PERMISSIONS = [
  "update-email-templates",
  "manage-email-templates",
] as const;

/**
 * Previewing an email with sample data. The preview route is a POST, which
 * the server reads as a create, so seeing the list alone does not reach it.
 */
export const EMAIL_TEMPLATE_PREVIEW_PERMISSIONS: readonly [
  "create-email-templates",
  "manage-email-templates",
] = EMAIL_TEMPLATE_CREATE_PERMISSIONS;

/** Deleting an email. */
export const EMAIL_TEMPLATE_DELETE_PERMISSIONS = [
  "delete-email-templates",
  "manage-email-templates",
] as const;

/** Seeing the providers email is sent through. */
export const EMAIL_PROVIDER_READ_PERMISSIONS = [
  "read-email-providers",
  "manage-email-providers",
] as const;

/** Adding a provider. */
export const EMAIL_PROVIDER_CREATE_PERMISSIONS = [
  "create-email-providers",
  "manage-email-providers",
] as const;

/**
 * Editing a provider or making it the default. Both are updates, and
 * `update-email-providers` is not seeded, so in practice this is the manage
 * grant; the server accepts either.
 */
export const EMAIL_PROVIDER_UPDATE_PERMISSIONS = [
  "update-email-providers",
  "manage-email-providers",
] as const;

/** Sending a test from a provider: a POST, which the server reads as a create. */
export const EMAIL_PROVIDER_TEST_PERMISSIONS: readonly [
  "create-email-providers",
  "manage-email-providers",
] = EMAIL_PROVIDER_CREATE_PERMISSIONS;

/** Deleting a provider. */
export const EMAIL_PROVIDER_DELETE_PERMISSIONS = [
  "delete-email-providers",
  "manage-email-providers",
] as const;

/**
 * Reading the delivery log: the Activity tab, and delivery information shown
 * elsewhere, such as when an email was last sent. Nobody holds it until the
 * delivery routes seed it, so everything it gates stays hidden until then.
 */
export const EMAIL_DELIVERIES_READ_PERMISSION = "read-email-deliveries";

/** The hub's tabs, in the order they appear. */
export type EmailHubTab = "messages" | "design" | "sending";

export interface EmailHubTabDefinition {
  id: EmailHubTab;
  label: string;
  href: string;
  /** Any one of these shows the tab. */
  permissions: readonly string[];
}

/**
 * Messages and Design show templates and layouts, Sending shows providers.
 * Activity joins when its screen does, gated on the delivery read grant.
 */
export const EMAIL_HUB_TABS: readonly EmailHubTabDefinition[] = [
  {
    id: "messages",
    label: "Messages",
    href: ROUTES.EMAIL,
    permissions: EMAIL_TEMPLATE_READ_PERMISSIONS,
  },
  {
    id: "design",
    label: "Design",
    href: ROUTES.EMAIL_DESIGN,
    permissions: EMAIL_TEMPLATE_READ_PERMISSIONS,
  },
  {
    id: "sending",
    label: "Sending",
    href: ROUTES.EMAIL_SENDING,
    permissions: EMAIL_PROVIDER_READ_PERMISSIONS,
  },
];

/** Any grant that shows at least one tab, so the hub's rail entry appears. */
export const EMAIL_HUB_PERMISSIONS: readonly string[] = [
  ...new Set(EMAIL_HUB_TABS.flatMap(tab => tab.permissions)),
];

/** The tabs this reader may see, in order. */
export function visibleEmailHubTabs(
  hasPermission: (slug: string) => boolean
): EmailHubTabDefinition[] {
  return EMAIL_HUB_TABS.filter(tab => tab.permissions.some(hasPermission));
}

/** Whether this reader holds any one of the grants. */
export function holdsAny(
  hasPermission: (slug: string) => boolean,
  permissions: readonly string[]
): boolean {
  return permissions.some(hasPermission);
}
