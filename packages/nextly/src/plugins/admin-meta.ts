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
import { resolutionError } from "./resolution-error";
import { collectPluginRoutes } from "./routes/collect-routes";
import { isRouteError } from "./routes/route-error";
import { validatedAdminWidgets } from "./validate-admin-widgets";
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
 * Resolve a menu item's destination and gate through the plugin's renameMap.
 *
 * An item naming one of the plugin's own collections is re-pointed at the slug
 * the host REGISTERED, and gated on the read permission that slug seeds. An
 * item naming none is copied through: it addresses something the rename cannot
 * move, and rewriting a path the author wrote literally would be a different
 * and much harder-to-predict rule.
 *
 * `collection` is dropped rather than forwarded. The admin's contract is a
 * resolved `to` and a resolved `requiredPermission`; shipping the declared
 * slug alongside them would offer a second answer to the same question, and
 * the stale one is the one that looks authoritative.
 *
 * Children are resolved too, so a nested item is no more likely to be stranded
 * than a top-level one.
 */
function resolvedMenuItem(
  item: PluginMenuItem,
  renameMap: Record<string, string>,
  owned: readonly string[],
  name: string
): PluginMenuItem {
  const children = item.children?.map(child =>
    resolvedMenuItem(child, renameMap, owned, name)
  );
  const withChildren = children ? { ...item, children } : item;

  // Destructured before the guard so the narrowing survives it: reading
  // `item.collection` and then indexing `withChildren.collection` are two
  // reads of two objects as far as the checker is concerned.
  const { collection, ...rest } = withChildren;
  if (collection === undefined) return withChildren;

  // Refused at registration, because there is nothing to observe later. A slug
  // this plugin does not own resolves to a perfectly well-formed path and a
  // perfectly well-formed permission, and both are wrong in the quietest way
  // available: the permission is never seeded, so every non-super-admin simply
  // does not see the item, and the super-admins who do see it get a link to a
  // list that does not exist. Neither surface can tell that from a role
  // legitimately lacking access.
  if (!owned.includes(collection)) {
    throw resolutionError(
      "menu-item-unowned-collection",
      `Plugin "${name}" has a menu item ("${withChildren.label}") naming ` +
        `collection "${collection}", which it does not contribute. Name one ` +
        `of: ${owned.join(", ") || "(none)"}.`,
      { plugin: name, collection, owned }
    );
  }

  const slug = renameMap[collection] ?? collection;
  return {
    ...rest,
    to: `/admin/collections/${slug}`,
    // The seeded per-collection read verb. Written from the resolved slug for
    // the same reason `to` is: a rename moves the permission the seeder
    // creates, and a gate naming the declared slug would hide the item from
    // exactly the readers who can open the list.
    requiredPermission: `read-${slug}`,
  };
}

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

export function buildPluginAdminMeta(
  plugins: PluginDefinition[],
  pluginOverrides: Record<string, PluginOverride> | undefined
): PluginAdminMeta[] {
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
      if (admin.menu && admin.menu.length > 0) {
        meta.menu = admin.menu.map(item =>
          resolvedMenuItem(
            item,
            plugin.renameMap ?? {},
            pluginCollectionSlugs(plugin),
            plugin.name
          )
        );
      }
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
      // Validated rather than copied, the same way `clientConfig` is above and
      // for a wider blast radius. A widget declaration never passes through
      // `registerWidget`, so nothing else stands between it and the single
      // `JSON.stringify` that serializes this whole payload -- and a value that
      // throws there fails `/api/admin-meta/workspace` for every admin, not
      // just this card. The same validator boot runs, so this path cannot
      // accept what boot rejected; called again here because the reduced value
      // is what publishes.
      const widgets = validatedAdminWidgets(plugin);
      if (widgets && widgets.length > 0) meta.widgets = widgets;
      if (admin.schemaBuilderSlot)
        meta.schemaBuilderSlot = admin.schemaBuilderSlot;
      if (admin.entryFormToolbarSlot)
        meta.entryFormToolbarSlot = admin.entryFormToolbarSlot;
    }

    // Routes move to `whenEnabled` when the plugin is disabled, because
    // `collectPluginRoutes` skips disabled plugins and so a disabled plugin
    // serves none. The `if/else` is what stops a route being reported as both
    // served and pending.
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
