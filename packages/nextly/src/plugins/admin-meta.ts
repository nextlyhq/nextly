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
import { isPermissionCollision } from "./permission-error";
import {
  type CollectedPermission,
  collectCustomPermissions,
  type PermissionConfigSource,
} from "./permissions/collect-permissions";
import { pluginCollectionSlugs } from "./plugin-admin-meta";
import type {
  PluginAdminAppearance,
  PluginCategory,
  PluginDefinition,
} from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";
import { collectPluginRoutes } from "./routes/collect-routes";
import { isRouteError } from "./routes/route-error";
import { validatedClientConfig } from "./validate-client-config";
import { validatePluginSlugs } from "./validate-slugs";

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
   * Declared custom permissions (identity + display fields only).
   *
   * Present whatever the enabled state, unlike the rest of the behavioral
   * surface, because these rows exist whatever the enabled state: the
   * permission fold covers disabled plugins too, the seeder creates them, and
   * new ones are granted to super_admin. A disabled plugin's permission is
   * held and assignable; what it protects is simply not mounted.
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
  routes?: Array<{ method: string; path: string; fullPath: string }>;
  /**
   * The routes a DISABLED plugin declares but does not currently serve.
   *
   * Routes only, and the omission of permissions is deliberate. Routes are the
   * asymmetric half: `collectPluginRoutes` covers enabled plugins only, so a
   * disabled plugin serves none. Permissions are folded over ALL plugins
   * including disabled ones, seeded, and assigned — so a disabled plugin's
   * permissions already exist, and listing them here would claim they are
   * pending when they are not.
   *
   * Populated only when the plugin is disabled, so this and `routes` above are
   * never both present. Nothing may concatenate them: a caller that did would
   * be claiming a disabled plugin serves endpoints it does not.
   *
   * Only routes that could actually mount appear. A path without a leading
   * slash makes `collectPluginRoutes` throw at boot once the plugin is
   * enabled, so presenting it as something enabling would add is a promise
   * this cannot keep.
   */
  whenEnabled?: { routes?: PluginAdminMeta["routes"] };
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
/**
 * The routes a plugin would actually serve, with the namespace they answer at.
 *
 * Asks `collectPluginRoutes` rather than restating its rules. That function is
 * the canonical answer to "would these mount": it rejects a path without a
 * leading slash and rejects two routes sharing a `(method, full path)`.
 * Re-implementing either predicate here would let the admin advertise a route
 * boot refuses, which is the whole failure this guards.
 *
 * Folded against the plugins that are ALREADY enabled, not against this plugin
 * alone, because a collision need not be self-inflicted: namespaces are built
 * from package names, so an enabled `foo` declaring `GET /bar/x` and a
 * disabled `foo/bar` declaring `GET /x` both resolve to `/plugins/foo/bar/x`.
 * Enabling the second is what fails, and a fold over one plugin cannot see it.
 *
 * The subject is forced enabled, since the question is what WOULD happen. Its
 * routes are then picked back out by owner: a collision reported against an
 * already-enabled sibling means the subject's route is the one that could not
 * be added.
 *
 * `undefined` when nothing would mount, so a caller renders nothing rather
 * than an empty section.
 */
function mountableRoutes(
  plugin: PluginDefinition,
  siblings: readonly PluginDefinition[]
): PluginAdminMeta["routes"] | undefined {
  const routes = plugin.contributes?.routes;
  if (!routes || routes.length === 0) return undefined;

  // Enabled siblings first, so a collision is attributed to the sibling that
  // already holds the path and the subject's route is the one rejected.
  const others = siblings.filter(
    other => other !== plugin && other.enabled !== false
  );

  let collected;
  try {
    collected = collectPluginRoutes([...others, { ...plugin, enabled: true }]);
  } catch (error) {
    // Only route errors reach here — `collectPluginRoutes` throws
    // `routeInvalidPathError` and `routeCollisionError` and nothing else — and
    // both mean the same thing to this caller: these declarations do not
    // mount, so there is nothing honest to advertise. Rethrown otherwise,
    // since that would be a defect rather than a verdict.
    if (!isRouteError(error)) throw error;
    return undefined;
  }

  // Method + path only, plus the namespace: handlers and middleware are code
  // and never serialize.
  const mine = collected.filter(c => c.pluginName === plugin.name);
  return mine.length > 0
    ? mine.map(c => ({
        method: c.method,
        path: c.path,
        fullPath: c.fullPath,
      }))
    : undefined;
}

/**
 * The custom permissions to describe on the PUBLIC admin-meta payload.
 *
 * That endpoint is served WITHOUT initializing services, so the config it reads
 * is whatever the route module stored — before any plugin `setup` transformer
 * has run. A transformer may legitimately resolve a collision between two
 * declarations, so the raw list can hold one that boot never sees, and
 * `collectCustomPermissions` throws on it. Letting that escape would take the
 * whole endpoint down — branding included — over a configuration that boots.
 *
 * Degrades to describing NO custom permissions rather than to describing the
 * raw declarations: a set that cannot be folded is a set this cannot attribute,
 * and attributing it wrongly is the thing the fold exists to prevent.
 *
 * Deliberately a different failure semantic from `collectPluginInfo`, which
 * folds the same declarations for the CLI and lets the collision throw — there
 * an invalid config should be reported, here it should not blank the admin.
 *
 * Only the collision is absorbed. Anything else is a defect, and rethrows.
 */
export function adminMetaPermissions(
  config: PermissionConfigSource & { plugins?: PluginDefinition[] }
): CollectedPermission[] {
  try {
    return collectCustomPermissions(config, config.plugins ?? []);
  } catch (error) {
    if (isPermissionCollision(error)) return [];
    throw error;
  }
}

export function buildPluginAdminMeta(
  plugins: PluginDefinition[],
  pluginOverrides: Record<string, PluginOverride> | undefined,
  permissions: readonly CollectedPermission[]
): PluginAdminMeta[] {
  // The permissions that actually become rows, indexed by the plugin that owns
  // them.
  //
  // TAKEN rather than folded here. A declaration and a seeded permission are
  // not the same set — `collectCustomPermissions` drops a `publish`/`unpublish`
  // declaration whose resource is a collection or single, since the seeder
  // emits that slug itself and keeps the row ownerless — so this must read the
  // collected set rather than `contributes.permissions`. But collecting it here
  // as well as at the caller would compute one authoritative answer twice and
  // leave two projections of it free to drift; `collectPluginInfo` already
  // collects the same set for the CLI's slug summary.
  //
  // `source` rather than `owner` decides what belongs to a plugin: the host's
  // sentinel owner is the literal `"app"`, and a plugin may legally be named
  // that, which would file every host-declared permission under it.
  const ownedPermissions = new Map<string, CollectedPermission[]>();
  for (const permission of permissions) {
    if (permission.source !== "plugin") continue;
    const owned = ownedPermissions.get(permission.owner);
    if (owned) owned.push(permission);
    else ownedPermissions.set(permission.owner, [permission]);
  }

  // Here, and not only at boot, because this is the one place a plugin list
  // becomes ADDRESSES: the slug below is the admin's URL for the plugin and
  // the key its host override is read by. Two boot paths do not reach it —
  // `createDynamicHandlers` initializes services lazily and serves the public
  // admin-meta endpoint before that happens, and a `setup` transformer can
  // rewrite `config.plugins` after `resolvePlugins` has already run. Both
  // would publish ambiguous addresses from a list nothing had checked.
  validatePluginSlugs(plugins);

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

    // Permissions are serialized whatever the enabled state, because they
    // EXIST whatever the enabled state: `collectCustomPermissions` folds over
    // every plugin including disabled ones (D49), the post-init seeder creates
    // the rows, and new ones are assigned to super_admin. Withholding them
    // here made the page disagree with the database — an operator could hold a
    // plugin's permission, see it in the roles UI, and find nothing on the
    // owning plugin's page to explain where it came from.
    //
    // Routes are the genuinely absent half: `collectPluginRoutes` skips
    // disabled plugins, so a disabled plugin serves none. Those move to
    // `whenEnabled`, and the `if/else` is what stops a route being reported as
    // both served and pending.
    const permissions = ownedPermissions.get(plugin.name);
    if (permissions && permissions.length > 0) {
      meta.permissions = permissions.map(p => ({
        action: p.action,
        resource: p.resource,
        // The name the row carries, which the collector already resolved from
        // the declared label or composed from the action and resource. Sending
        // it under `label` keeps this page and the roles UI naming the same
        // permission the same way.
        label: p.name,
        ...(p.description ? { description: p.description } : {}),
        ...(p.danger ? { danger: p.danger } : {}),
      }));
    }

    const declaredRoutes = mountableRoutes(plugin, plugins);
    if (isEnabled) {
      if (declaredRoutes) meta.routes = declaredRoutes;
    } else if (declaredRoutes) {
      meta.whenEnabled = { routes: declaredRoutes };
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
