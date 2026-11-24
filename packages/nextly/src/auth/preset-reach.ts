/**
 * Which preset roles each collection, and each declared permission, is
 * opened to: the configuration's word, and for collections a site had before
 * collections started closed, the grants they held then.
 *
 * A collection is reachable by a built-in preset role (Admin, Editor, Author,
 * Viewer) only once it is opened to that preset by name. Without that, adding
 * a collection, from code, the Schema Builder or a plugin, would hand its
 * grants to every preset at the next start, and a person given Viewer to read
 * one thing would read every collection added after.
 *
 * Pure: the seeder reads the registry, the configuration and the grandfather
 * record (`domains/meta/preset-grants-grandfathered`), and this module turns
 * them into the {@link PresetReach} the preset rules are resolved with.
 *
 * @module auth/preset-reach
 */

import type { PluginPermission } from "../plugins/contributions";

import {
  PRESET_ROLE_SLUGS,
  type PresetPermission,
  type PresetReach,
  type PresetRoleSlug,
} from "./role-presets";

/** What a collection's configuration says about the preset roles. */
export interface CollectionGrants {
  /**
   * The preset roles this collection is opened to, by slug. Each applies its
   * usual rule here (an Author creates and edits but does not publish or
   * delete; a Viewer reads). `[]` opens it to none of them.
   *
   * Left out, the collection is opened to no preset role, unless it existed
   * before collections started closed: then it keeps the presets that held
   * its grants then, and the start says so until this is set.
   *
   * @experimental
   */
  presets?: readonly PresetRoleSlug[];
}

/** The parts of a configuration that open collections and permissions to presets. */
export interface PresetDeclarationSource {
  collections?: ReadonlyArray<{ slug: string; grants?: CollectionGrants }>;
  permissions?: ReadonlyArray<
    Pick<PluginPermission, "action" | "resource" | "presets">
  >;
  plugins?: ReadonlyArray<{
    contributes?: {
      collections?: ReadonlyArray<{ slug: string; grants?: CollectionGrants }>;
      permissions?: ReadonlyArray<
        Pick<PluginPermission, "action" | "resource" | "presets">
      >;
    };
  }>;
  /** The app's word on any collection, a plugin's or the Schema Builder's included. */
  presetGrants?: Readonly<Record<string, readonly PresetRoleSlug[]>>;
}

/** What the configuration opens to the presets, read once per seeding. */
export interface PresetDeclarations {
  /** By collection slug: the presets it is opened to. */
  collections: ReadonlyMap<string, readonly string[]>;
  /** By declared permission, `action:resource` in lower case: the presets it names. */
  permissions: ReadonlyMap<string, readonly string[]>;
}

/** The key a declared permission is matched by, as the seeder matches rows. */
function permissionKey(action: string, resource: string): string {
  return `${action.toLowerCase()}:${resource.toLowerCase()}`;
}

/**
 * Every opening the configuration states. For a collection, the app's
 * `presetGrants` wins over the collection's own `grants.presets`, so an app
 * can open or close a plugin's collection without editing the plugin.
 */
export function presetDeclarationsOf(
  config: PresetDeclarationSource
): PresetDeclarations {
  const collections = new Map<string, readonly string[]>();
  const permissions = new Map<string, readonly string[]>();
  const fromCollection = (collection: {
    slug: string;
    grants?: CollectionGrants;
  }) => {
    const presets = collection.grants?.presets;
    // The first declaration of a slug stands, as the app's own collection
    // stands over a plugin's of the same slug elsewhere in the config.
    if (presets !== undefined && !collections.has(collection.slug)) {
      collections.set(collection.slug, [...presets]);
    }
  };
  const fromPermission = (
    permission: Pick<PluginPermission, "action" | "resource" | "presets">
  ) => {
    if (permission.presets === undefined) return;
    permissions.set(permissionKey(permission.action, permission.resource), [
      ...permission.presets,
    ]);
  };
  for (const collection of config.collections ?? []) fromCollection(collection);
  for (const permission of config.permissions ?? []) fromPermission(permission);
  for (const plugin of config.plugins ?? []) {
    for (const collection of plugin.contributes?.collections ?? []) {
      fromCollection(collection);
    }
    for (const permission of plugin.contributes?.permissions ?? []) {
      fromPermission(permission);
    }
  }
  for (const [slug, presets] of Object.entries(config.presetGrants ?? {})) {
    collections.set(slug, [...presets]);
  }
  return { collections, permissions };
}

/** Everything the reach is worked out from. */
export interface PresetReachInputs {
  /** Every collection's slug, as the registry holds them. */
  collectionSlugs: Iterable<string>;
  declarations: PresetDeclarations;
  /**
   * By collection slug, the presets that held its grants before collections
   * started closed: the grandfather record. Empty on a site set up since.
   */
  grandfathered: ReadonlyMap<string, readonly string[]>;
}

/**
 * The reach the preset rules are resolved with.
 *
 * - A collection's own permissions reach the presets the configuration opens
 *   it to; where it says nothing, those the grandfather record keeps for it;
 *   where neither does, none.
 * - A permission an app or a plugin declares with `presets` reaches those;
 *   one declared without them reaches every preset, as each one's rule
 *   decides (only Admin takes a plugin's permission, and Viewer its read).
 * - Everything else, the framework's own resources and Singles among them,
 *   reaches every preset, as before.
 */
export function presetReachOf(inputs: PresetReachInputs): PresetReach {
  const collections = new Set(inputs.collectionSlugs);
  const { declarations, grandfathered } = inputs;
  const cache = new Map<string, ReadonlySet<string>>();
  const setOf = (key: string, presets: readonly string[]) => {
    let set = cache.get(key);
    if (set === undefined) {
      set = new Set(presets);
      cache.set(key, set);
    }
    return set;
  };
  return {
    presetsFor(permission: PresetPermission) {
      if (permission.owner !== null) {
        const key = permissionKey(permission.action, permission.resource);
        const declared = declarations.permissions.get(key);
        return declared === undefined
          ? undefined
          : setOf(`permission:${key}`, declared);
      }
      const slug = permission.resource;
      if (!collections.has(slug)) return undefined;
      const opened =
        declarations.collections.get(slug) ?? grandfathered.get(slug) ?? [];
      return setOf(`collection:${slug}`, opened);
    },
  };
}

/** What a start says about collections and the preset roles. */
export interface PresetReachNotice {
  /** Collections kept open to presets only by the grandfather record. */
  grandfathered: Array<{ slug: string; presets: readonly string[] }>;
  /** Collections no configuration opens and the record does not keep. */
  closed: string[];
}

/**
 * The collections a start names: each one still open to presets only because
 * it was there before collections started closed, and each one that nothing
 * opens. A collection the configuration speaks for, `[]` included, is named
 * in neither: its state is the one asked for.
 */
export function presetReachNotice(
  inputs: PresetReachInputs
): PresetReachNotice {
  const grandfathered: PresetReachNotice["grandfathered"] = [];
  const closed: string[] = [];
  for (const slug of [...new Set(inputs.collectionSlugs)].sort()) {
    if (inputs.declarations.collections.has(slug)) continue;
    const kept = inputs.grandfathered.get(slug);
    if (kept !== undefined && kept.length > 0) {
      grandfathered.push({ slug, presets: kept });
    } else {
      closed.push(slug);
    }
  }
  return { grandfathered, closed };
}

/**
 * The notice as log text: `kept`, a warning, for collections the record alone
 * keeps open, since they close the day the record is dropped; `closed`, for
 * information, for collections nothing opens, since closed is the default
 * asked for and only worth naming. Each `null` where there is nothing to say.
 */
export function formatPresetReachNotice(notice: PresetReachNotice): {
  kept: string | null;
  closed: string | null;
} {
  const kept =
    notice.grandfathered.length === 0
      ? null
      : [
          "[Nextly] These collections are open to preset roles only because they existed before new collections started closed to them. Add `grants: { presets: [...] }` to each (or `presetGrants` in the config for a plugin's or a Schema Builder collection) to keep that, or `presets: []` to close it:",
          ...notice.grandfathered.map(
            ({ slug, presets }) => `  - "${slug}": ${presets.join(", ")}`
          ),
        ].join("\n");
  const closed =
    notice.closed.length === 0
      ? null
      : [
          "[Nextly] These collections are open to no preset role (Admin, Editor, Author, Viewer): only super-admins and roles granted them by name reach them. Open one with `grants: { presets: [...] }`, or `presetGrants` in the config, or say `presets: []` to keep it closed and stop this notice:",
          ...notice.closed.map(slug => `  - "${slug}"`),
        ].join("\n");
  return { kept, closed };
}

/**
 * The preset slugs a list names that are not presets, for a configuration
 * check to refuse: a misspelt `"editors"` would otherwise open nothing and
 * say nothing.
 */
export function unknownPresetSlugs(presets: readonly string[]): string[] {
  const known = new Set<string>(PRESET_ROLE_SLUGS);
  return presets.filter(slug => !known.has(slug));
}
