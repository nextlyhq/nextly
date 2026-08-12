import type { AdminCapabilities } from "@admin/types/permissions";

interface PluginsSectionInputs {
  /** True while permissions or the collections query are still resolving. */
  isPending: boolean;
  /** True when at least one plugin-owned collection is visible to this user. */
  hasVisiblePluginCollection: boolean;
}

/**
 * Whether the Plugins entry appears in the primary rail.
 *
 * The rail item exists to open the plugins panel, so it is shown exactly when
 * that panel has a destination this user can reach. The two arms below are the
 * two kinds of destination, and they admit different users:
 *
 * - `canManageSettings` reaches `/admin/plugins`, which is guarded by that
 *   permission. It needs nothing installed: the page lists installed plugins
 *   and its empty state explains that plugins are added through the Nextly
 *   config, so a project with none still has somewhere to go.
 * - `canViewCollections` plus a visible plugin-owned collection reaches that
 *   collection through the panel. Such a user does not get the overview link,
 *   which is why the collection itself has to be the reachable thing.
 *
 * A global installed count is deliberately not an input. It answers "does the
 * project have plugins", not "can this user reach any of them", and for a
 * collection reader whose plugin is metadata-only or whose collections are all
 * denied those differ: the rail item would open a panel with nothing in it.
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

  // Pending counts as reachable so the entry does not flicker out and back in
  // while the collections query resolves.
  return inputs.isPending || inputs.hasVisiblePluginCollection;
}
