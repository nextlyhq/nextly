/**
 * Pure serializer for plugin admin metadata delivered to the client via
 * `/api/admin-meta` (D19–D21). Kept pure + standalone so it is unit-testable
 * and so the route handler stays thin.
 *
 * @module plugins/admin-meta
 */

import type { PluginOverride } from "../shared/types/config";

import type { PluginAdminPage, PluginMenuItem } from "./admin-contributions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type { PluginAdminAppearance, PluginDefinition } from "./plugin-context";

/**
 * The serialized admin-meta entry for a single plugin, consumed by the admin
 * sidebar/router. Mirrors the client `PluginMetadata` shape.
 */
export interface PluginAdminMeta {
  name: string;
  version: string;
  description?: string;
  placement: string;
  order?: number;
  after?: PluginOverride["after"];
  appearance?: PluginAdminAppearance;
  collections: string[];
  /** Sidebar menu items (D20) — present only for enabled plugins. */
  menu?: PluginMenuItem[];
  /** Custom admin pages (D21) — present only for enabled plugins. */
  pages?: PluginAdminPage[];
  /** Settings UI (D21) — present only for enabled plugins. */
  settings?: { component: string };
}

/**
 * Derive a plugin's admin slug from its name (e.g. `"@acme/p"` → `"acme-p"`),
 * used to look up host `pluginOverrides` and to namespace plugin admin routes.
 */
export function pluginAdminSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build the `plugins[]` admin-meta array from the registered plugins, applying
 * host `pluginOverrides` (placement/order/after/appearance) and folding each
 * enabled plugin's `contributes.admin` menu/pages/settings (D20/D21).
 *
 * Disabled plugins (`enabled: false`) keep their entry (their schema still
 * applies) but contribute NO behavioral admin UI (D49) — no menu/pages/settings.
 */
export function buildPluginAdminMeta(
  plugins: PluginDefinition[],
  pluginOverrides: Record<string, PluginOverride> | undefined
): PluginAdminMeta[] {
  return plugins.map(plugin => {
    const slug = pluginAdminSlug(plugin.name);
    const hostOverride = pluginOverrides?.[slug];

    // Shallow merge appearance: host override fields win, author defaults kept.
    const effectiveAppearance = hostOverride?.appearance
      ? { ...plugin.admin?.appearance, ...hostOverride.appearance }
      : plugin.admin?.appearance;

    const meta: PluginAdminMeta = {
      name: plugin.name,
      version: plugin.version,
      description: plugin.admin?.description,
      placement:
        hostOverride?.placement ?? plugin.admin?.placement ?? "plugins",
      order: hostOverride?.order ?? plugin.admin?.order,
      after: hostOverride?.after ?? plugin.admin?.after,
      appearance: effectiveAppearance,
      collections: pluginCollectionSlugs(plugin),
    };

    // Behavioral admin UI (D20/D21) only for enabled plugins (D49).
    const isEnabled = plugin.enabled !== false;
    const admin = plugin.contributes?.admin;
    if (isEnabled && admin) {
      if (admin.menu && admin.menu.length > 0) meta.menu = admin.menu;
      if (admin.pages && admin.pages.length > 0) meta.pages = admin.pages;
      if (admin.settings) meta.settings = admin.settings;
    }

    return meta;
  });
}
