import { API_KEYS_LIST_PERMISSIONS } from "@admin/constants/navigation";
import type { AdminCapabilities } from "@admin/types/permissions";

/** Any webhook grant reaches the list route, which is an any-of of these. */
const WEBHOOK_LIST_PERMISSIONS = [
  "read-webhooks",
  "update-webhooks",
  "create-webhooks",
] as const;

/** Whether this reader can open the API Keys list. */
export function canAccessApiKeys(
  hasPermission: (slug: string) => boolean
): boolean {
  return API_KEYS_LIST_PERMISSIONS.some(hasPermission);
}

/** Whether this reader can open the Webhooks list. */
export function canAccessWebhooks(
  hasPermission: (slug: string) => boolean
): boolean {
  return WEBHOOK_LIST_PERMISSIONS.some(hasPermission);
}

/**
 * Whether the Settings entry appears in the primary rail.
 *
 * Settings is not one destination but a panel, and the grants that reach into
 * it are not one permission: it hosts email configuration, API keys, webhooks
 * and User Management alongside the settings screens themselves, each answering
 * to its own grant. A reader whose only access is `read-users` must still see
 * the icon, or the destination they can open has no route to it.
 *
 * Shown while the grants are still resolving, matching the rest of the rail.
 * The alternative flashes: an entry appearing a moment after the page settles
 * reads as the UI changing its mind, and every destination refuses on its own.
 *
 * @module components/layout/sidebar/lib/has-settings-section
 */
export function hasSettingsSection(
  capabilities: Pick<
    AdminCapabilities,
    | "canViewSettings"
    | "canManageEmailProviders"
    | "canManageEmailTemplates"
    | "canViewUsers"
    | "canViewRoles"
  >,
  inputs: {
    /** True while permissions are still resolving. */
    isPending: boolean;
    hasPermission: (slug: string) => boolean;
  }
): boolean {
  if (inputs.isPending) return true;
  return (
    capabilities.canViewSettings ||
    capabilities.canManageEmailProviders ||
    capabilities.canManageEmailTemplates ||
    capabilities.canViewUsers ||
    capabilities.canViewRoles ||
    canAccessApiKeys(inputs.hasPermission) ||
    canAccessWebhooks(inputs.hasPermission)
  );
}
