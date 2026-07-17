/**
 * Pure serializer for plugin admin metadata delivered to the client via
 * `/api/admin-meta`. Kept pure + standalone so it is unit-testable
 * and so the route handler stays thin.
 *
 * @module plugins/admin-meta
 */

import type { PluginOverride } from "../shared/types/config";

import type {
  HeaderButtonId,
  PluginAdminPage,
  PluginAdminWidget,
  PluginMenuItem,
} from "./admin-contributions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type {
  PluginAdminAppearance,
  PluginCategory,
  PluginDefinition,
} from "./plugin-context";

/**
 * The serialized admin-meta entry for a single plugin, consumed by the admin
 * sidebar/router. Mirrors the client `PluginMetadata` shape.
 */
export interface PluginAdminMeta {
  name: string;
  version: string;
  description?: string;
  /** Author shown in the plugins list; mirrors package.json by convention. */
  author?: string;
  /** Homepage URL linked from the plugin detail page. */
  homepage?: string;
  /** Source repository URL linked from the plugin detail page. */
  repository?: string;
  /** Documentation URL when distinct from the homepage. */
  docsUrl?: string;
  /** SPDX license identifier shown on the plugin detail page. */
  license?: string;
  /** Category the plugins list filters by (controlled vocabulary). */
  category?: PluginCategory;
  /** Free-form descriptive tags shown on the plugin detail page. */
  tags?: string[];
  /**
   * Whether the plugin's behavior is active. Serialized explicitly (not
   * inferred from missing keys) so the admin can render an honest status.
   */
  enabled: boolean;
  /** Required plugin dependencies → version range, for the detail page. */
  dependsOn?: Record<string, string>;
  placement: string;
  order?: number;
  after?: PluginOverride["after"];
  appearance?: PluginAdminAppearance;
  collections: string[];
  /** Slugs of contributed singles, for the detail page's contributions view. */
  singles?: string[];
  /** Slugs of contributed components, for the detail page's contributions view. */
  components?: string[];
  /**
   * Declared custom permissions (identity + display fields only) — present
   * only for enabled plugins, like the rest of the behavioral surface.
   */
  permissions?: Array<{
    action: string;
    resource: string;
    label?: string;
    description?: string;
    danger?: boolean;
  }>;
  /**
   * Declared HTTP routes, summarized as method + path. Handlers and
   * middleware are code and never serialize; the admin only names what the
   * plugin mounts. Present only for enabled plugins (routes of a disabled
   * plugin are not mounted).
   */
  routes?: Array<{ method: string; path: string }>;
  /** Sidebar menu items — present only for enabled plugins. */
  menu?: PluginMenuItem[];
  /** Custom admin pages — present only for enabled plugins. */
  pages?: PluginAdminPage[];
  /** Settings UI — present only for enabled plugins. */
  settings?: { component: string };
  /** Admin header-slot component — present only for enabled plugins. */
  headerSlot?: string;
  /** Header customization — present only for enabled plugins. */
  header?: {
    slot?: string;
    hideDefaults?: boolean;
    hide?: HeaderButtonId[];
  };
  /** Dashboard widgets — present only for enabled plugins. */
  widgets?: PluginAdminWidget[];
  /** Schema-builder slot component path — present only for enabled plugins. */
  schemaBuilderSlot?: string;
  /** Entry/single form toolbar slot component path — present only for enabled plugins. */
  entryFormToolbarSlot?: string;
  /**
   * Custom field types — `type` → admin editor component path, so the
   * admin renders fields of these types. Serialized regardless of enabled state
   * (a disabled plugin's collections + their fields are retained, D14/D49).
   */
  fieldTypes?: Array<{ type: string; component: string; layout?: "takeover" }>;
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
 * enabled plugin's `contributes.admin` menu/pages/settings.
 *
 * Disabled plugins (`enabled: false`) keep their entry (their schema still
 * applies) but contribute NO behavioral admin UI — no menu/pages/settings.
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

    const isEnabled = plugin.enabled !== false;

    const meta: PluginAdminMeta = {
      name: plugin.name,
      version: plugin.version,
      description: plugin.admin?.description,
      // Identity metadata serializes regardless of enabled state — a disabled
      // plugin is still installed and the admin still describes it honestly.
      ...(plugin.author ? { author: plugin.author } : {}),
      ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
      ...(plugin.repository ? { repository: plugin.repository } : {}),
      ...(plugin.docsUrl ? { docsUrl: plugin.docsUrl } : {}),
      ...(plugin.license ? { license: plugin.license } : {}),
      ...(plugin.category ? { category: plugin.category } : {}),
      ...(plugin.tags && plugin.tags.length > 0 ? { tags: plugin.tags } : {}),
      enabled: isEnabled,
      ...(plugin.dependsOn && Object.keys(plugin.dependsOn).length > 0
        ? { dependsOn: plugin.dependsOn }
        : {}),
      placement:
        hostOverride?.placement ?? plugin.admin?.placement ?? "plugins",
      order: hostOverride?.order ?? plugin.admin?.order,
      after: hostOverride?.after ?? plugin.admin?.after,
      appearance: effectiveAppearance,
      collections: pluginCollectionSlugs(plugin),
    };

    // Contributed singles/components slugs, so the detail page can list
    // everything the plugin adds without loading the plugin itself.
    const singles = plugin.contributes?.singles?.map(s => s.slug) ?? [];
    if (singles.length > 0) meta.singles = singles;
    const components = plugin.contributes?.components?.map(c => c.slug) ?? [];
    if (components.length > 0) meta.components = components;

    // Behavioral admin UI only for enabled plugins.
    const admin = plugin.contributes?.admin;
    if (isEnabled && admin) {
      if (admin.menu && admin.menu.length > 0) meta.menu = admin.menu;
      if (admin.pages && admin.pages.length > 0) meta.pages = admin.pages;
      if (admin.settings) meta.settings = admin.settings;
      // Header customization. `header.slot` supersedes the
      // deprecated top-level `headerSlot`; keep `meta.headerSlot` mirrored for
      // back-compat.
      const slot = admin.header?.slot ?? admin.headerSlot;
      const hideDefaults = admin.header?.hideDefaults;
      const hide = admin.header?.hide;
      if (slot || hideDefaults || (hide && hide.length > 0)) {
        meta.header = {
          ...(slot ? { slot } : {}),
          ...(hideDefaults ? { hideDefaults } : {}),
          ...(hide && hide.length > 0 ? { hide } : {}),
        };
      }
      if (slot) meta.headerSlot = slot;
      if (admin.widgets && admin.widgets.length > 0)
        meta.widgets = admin.widgets;
      if (admin.schemaBuilderSlot)
        meta.schemaBuilderSlot = admin.schemaBuilderSlot;
      if (admin.entryFormToolbarSlot)
        meta.entryFormToolbarSlot = admin.entryFormToolbarSlot;
    }

    // Behavioral contributions summarized for the detail page, enabled only:
    // a disabled plugin's routes are not mounted and its permissions grant
    // nothing, so listing them would overstate what the install does.
    if (isEnabled) {
      const permissions = plugin.contributes?.permissions;
      if (permissions && permissions.length > 0) {
        meta.permissions = permissions.map(p => ({
          action: p.action,
          resource: p.resource,
          ...(p.label ? { label: p.label } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.danger ? { danger: p.danger } : {}),
        }));
      }
      const routes = plugin.contributes?.routes;
      if (routes && routes.length > 0) {
        // Method + path only: handlers/middleware are code and never serialize.
        meta.routes = routes.map(r => ({ method: r.method, path: r.path }));
      }
    }

    // Custom field types — serialized regardless of enabled state so the
    // admin can render fields of these types in retained collections.
    const fieldTypes = plugin.contributes?.fieldTypes;
    if (fieldTypes && fieldTypes.length > 0) {
      meta.fieldTypes = fieldTypes.map(ft => ({
        type: ft.type,
        component: ft.component,
        ...(ft.layout ? { layout: ft.layout } : {}),
      }));
    }

    return meta;
  });
}
