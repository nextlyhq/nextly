import type { AdminCapabilities } from "@admin/types/permissions";

interface PluginsSectionInputs {
  /** True while permissions or the collections query are still resolving. */
  isPending: boolean;
  /** True when at least one plugin-owned collection is visible in this section. */
  hasVisiblePluginCollection: boolean;
  /** How many plugins `/api/admin-meta` reports as registered. */
  installedPluginCount: number;
}

/**
 * Whether the Plugins entry appears in the primary rail.
 *
 * Extracted for the same reason `resolveItemHref` was: the decision is a pure
 * function of a few inputs, and reaching it through a rendered `DualSidebar`
 * needs the branding, media, permission and collection providers all stood up.
 * A test that cannot reach the real predicate proves nothing about what the
 * rail renders, which is the failure this file exists to prevent. Only the
 * plugins predicate is extracted, because it is the one whose rule changed;
 * the sibling sections keep their inline form until they need the same.
 *
 * Two arms, and they admit different users on purpose:
 *
 * - `canManageSettings` shows the entry unconditionally, including on a fresh
 *   project with nothing installed. The plugins page is how a plugin gets
 *   installed, so gating it on already having one leaves a new project with no
 *   route to it.
 * - The collections arm keeps the entry for a user who can read a plugin-owned
 *   collection but cannot manage settings. They reach that collection through
 *   the sub-sidebar; `resolveItemHref` deliberately does not navigate them to
 *   the guarded page.
 *
 * @module components/layout/sidebar/lib/has-plugins-section
 */
export function hasPluginsSection(
  capabilities: Pick<
    AdminCapabilities,
    "canManageSettings" | "canViewCollections"
  >,
  inputs: PluginsSectionInputs
): boolean {
  if (capabilities.canManageSettings) return true;

  if (!capabilities.canViewCollections) return false;

  return (
    inputs.isPending ||
    inputs.hasVisiblePluginCollection ||
    inputs.installedPluginCount > 0
  );
}
