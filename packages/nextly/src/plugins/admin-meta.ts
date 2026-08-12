/**
 * Pure serializer for plugin admin metadata delivered to the client via
 * `/api/admin-meta`. Kept pure + standalone so it is unit-testable
 * and so the route handler stays thin.
 *
 * @module plugins/admin-meta
 */

import type {
  FieldStoragePrimitive,
  FieldTypeCategory,
} from "../collections/fields/catalog";
import type { PluginOverride } from "../shared/types/config";

import type {
  HeaderButtonId,
  PluginAdminPage,
  PluginAdminWidget,
  PluginMenuItem,
} from "./admin-contributions";
import type { FieldSurface } from "./contributions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type {
  PluginAdminAppearance,
  PluginCategory,
  PluginDefinition,
} from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { validatedClientConfig } from "./validate-client-config";

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
  /** Slugs of contributed field groups, for the detail page's contributions view. */
  fieldGroups?: string[];
  /**
   * The plugin's own configuration for its admin components. Served to
   * anonymous callers, because this endpoint needs no authentication, and
   * JSON-only; see `PluginAdminContributions.clientConfig`.
   */
  clientConfig?: Record<string, unknown>;
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
   * Custom field types — `type` → admin editor component path (so the admin
   * renders fields of these types) plus the picker presentation (label, hint,
   * icon, category) and the `surfaces` the type opted into (so each surface's
   * picker can offer only the types meant for it). Serialized regardless of
   * enabled state (a disabled plugin's collections + their fields are
   * retained, D14/D49).
   */
  fieldTypes?: Array<{
    type: string;
    component: string;
    storage: FieldStoragePrimitive;
    layout?: "takeover";
    label?: string;
    description?: string;
    icon?: string;
    category?: FieldTypeCategory;
    surfaces?: readonly FieldSurface[];
  }>;
}

/**
 * Re-exported from `./plugin-slug`, which has no imports so the admin can take
 * the same implementation from `nextly/config` without this module's
 * dependencies. Kept exported here because this is where every existing
 * server-side caller imports it from.
 */
export { pluginAdminSlug } from "./plugin-slug";

/**
 * The value if it survives a JSON round trip unchanged, otherwise `undefined`.
 *
 * Round-tripped rather than type-walked, because the question is exactly "will
 * the client see what the plugin wrote". A structural check would have to keep
 * its own list of things JSON drops, and that list is the thing that goes out
 * of date — `Date`, `Map`, `Set`, `BigInt`, `undefined` in an array, a getter
 * that throws, a `toJSON` that rewrites the value. Comparing the result to the
 * input catches all of them, including the ones nobody enumerated.
 */
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

    // Contributed singles/field-group slugs, so the detail page can list
    // everything the plugin adds without loading the plugin itself.
    const singles = plugin.contributes?.singles?.map(s => s.slug) ?? [];
    if (singles.length > 0) meta.singles = singles;
    const fieldGroups = plugin.contributes?.fieldGroups?.map(c => c.slug) ?? [];
    if (fieldGroups.length > 0) meta.fieldGroups = fieldGroups;

    // Serialized regardless of enabled state, on the same reasoning as
    // `fieldTypes` below: a disabled plugin keeps its collections and their
    // fields, so its field editors still MOUNT, and an editor configured by
    // this reads `undefined` without it. For the page builder that turns a
    // configured allowlist into an empty one and makes remote media vanish
    // from entries that render perfectly well otherwise. Menus and pages are
    // withheld because a disabled plugin does not render them at all; a
    // component that still renders still needs its configuration.
    //
    // Rejected rather than repaired when it will not round-trip. A config that
    // arrives with its `Date`s turned into strings and its functions turned
    // into nothing is harder to diagnose than one that never arrives, because
    // the shape the component reads still looks plausible.
    // The same validator boot runs, so this path cannot accept what boot
    // rejected. Called again here because the reduced value is what publishes.
    const validated = validatedClientConfig(plugin);
    if (validated !== undefined) meta.clientConfig = validated;

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
        // The storage primitive travels to the browser because binding
        // compatibility is decided from it: a plugin type is not in the
        // built-in union, so a picker cannot tell what its values look like
        // without it.
        storage: ft.storage,
        ...(ft.layout ? { layout: ft.layout } : {}),
        ...(ft.label ? { label: ft.label } : {}),
        ...(ft.description ? { description: ft.description } : {}),
        ...(ft.icon ? { icon: ft.icon } : {}),
        ...(ft.category ? { category: ft.category } : {}),
        ...(ft.surfaces ? { surfaces: ft.surfaces } : {}),
      }));
    }

    return meta;
  });
}
