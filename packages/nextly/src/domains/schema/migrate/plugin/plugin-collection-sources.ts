/**
 * Who contributed each code-first collection, Single and field group a plugin
 * adds: the one rule every road that writes a registry row (the start's and the
 * reload's code-first sync, `nextly db:sync` and `nextly migrate`'s registry
 * writer) gives the row its origin by.
 *
 * @module domains/schema/migrate/plugin/plugin-collection-sources
 */

import { renamedSlug } from "../../../../plugins/plugin-slug";

/** An entity a plugin declares, as far as the rule reads it. */
interface Declared {
  slug: string;
}

/** The part of a plugin definition the rule reads. */
interface ContributingPlugin {
  name: string;
  /** Each contributed slug the host renamed, to the slug it gave it. */
  renameMap?: Record<string, string>;
  /** The deprecated top-level key, whose collections the plugin's own `setup` adds. */
  collections?: readonly Declared[];
  contributes?: {
    collections?: readonly Declared[];
    singles?: readonly Declared[];
    fieldGroups?: readonly Declared[];
  };
}

/** The origin of a registry row a plugin's declaration owns. */
export type PluginSource = `plugin:${string}`;

/** Each entity a plugin contributed, by kind and slug, as `plugin:<name>`. */
export interface PluginEntitySources {
  readonly collections: ReadonlyMap<string, PluginSource>;
  readonly singles: ReadonlyMap<string, PluginSource>;
  readonly fieldGroups: ReadonlyMap<string, PluginSource>;
  /**
   * Those of `collections` that are the plugin's by its legacy top-level key alone. Such a
   * collection can be one a demote handed to the Schema Builder, and stays the Builder's
   * (`CodeFirstCollectionConfig.yieldsToBuilder`), where one under `contributes` is taken back.
   */
  readonly legacyCollections: ReadonlySet<string>;
}

/**
 * What a collection's sync payload says of its owner: the app (`code`) or the
 * plugin it belongs to, and whether it yields to the Schema Builder.
 */
export function collectionOwner(
  sources: PluginEntitySources,
  slug: string
): { source: "code" | PluginSource; yieldsToBuilder?: true } {
  return {
    source: sources.collections.get(slug) ?? "code",
    ...(sources.legacyCollections.has(slug) ? { yieldsToBuilder: true } : {}),
  };
}

/**
 * `plugin:<name>` for each collection, Single and field group a plugin declares
 * in `contributes`, by the slug the configuration holds it under: the one the
 * host renamed it to (`renameMap`), or the one the plugin declares. A slug a
 * rename vacated is free, so an entity the app declares there is the app's.
 * A collection under the plugin's legacy top-level `collections` is the
 * plugin's by the slug it declares, which no rename reaches; one `contributes`
 * declares at the same slug wins. Any entity not listed is the app's own
 * (`code`). Drives locking, `nextly prune` and what
 * `db:sync --remove-orphaned` deletes.
 */
export function pluginEntitySources(
  plugins: readonly ContributingPlugin[]
): PluginEntitySources {
  return sourcesBy(plugins, renamedSlug);
}

/**
 * {@link pluginEntitySources} of the collections a plugin declares in
 * `contributes` alone: the ones it registers at every start whoever holds the
 * address, so none is handed to the Schema Builder. One under the legacy key
 * can be, so it is not among them.
 */
export function pluginCollectionSources(
  plugins: readonly ContributingPlugin[]
): ReadonlyMap<string, PluginSource> {
  const { collections, legacyCollections } = pluginEntitySources(plugins);
  return new Map(
    [...collections].filter(([slug]) => !legacyCollections.has(slug))
  );
}

/**
 * {@link pluginEntitySources} by the slug each plugin declares, whatever the
 * host renamed it to: what a rollback finds the owner of a row it re-creates
 * by. A migration's snapshot records no plugin, so a rollback cannot tell
 * whether a rename was made at the point it goes back to, and does not read
 * one.
 */
export function declaredEntitySources(
  plugins: readonly ContributingPlugin[]
): PluginEntitySources {
  return sourcesBy(plugins, (_plugin, declared) => declared);
}

type SlugOf = (plugin: ContributingPlugin, declared: string) => string;

function sourcesBy(
  plugins: readonly ContributingPlugin[],
  slugOf: SlugOf
): PluginEntitySources {
  const sources = {
    collections: new Map<string, PluginSource>(),
    singles: new Map<string, PluginSource>(),
    fieldGroups: new Map<string, PluginSource>(),
    legacyCollections: new Set<string>(),
  };
  // The legacy ones first, so a collection any plugin contributes at the same slug wins. One the
  // same plugin also contributes is that contribution, under the slug the host may have given it.
  for (const plugin of plugins) {
    const contributed = new Set(
      plugin.contributes?.collections?.map(({ slug }) => slug)
    );
    for (const { slug } of plugin.collections ?? []) {
      if (contributed.has(slug)) continue;
      sources.collections.set(slug, `plugin:${plugin.name}`);
      sources.legacyCollections.add(slug);
    }
  }
  for (const plugin of plugins) {
    for (const kind of ["collections", "singles", "fieldGroups"] as const) {
      for (const { slug } of plugin.contributes?.[kind] ?? []) {
        const held = slugOf(plugin, slug);
        sources[kind].set(held, `plugin:${plugin.name}`);
        if (kind === "collections") sources.legacyCollections.delete(held);
      }
    }
  }
  return sources;
}
