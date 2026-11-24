/**
 * Who contributed each code-first collection a plugin adds: the one rule the
 * start's code-first sync and `nextly migrate`'s registry writer give a
 * collection's registry row its origin by.
 *
 * @module domains/schema/migrate/plugin/plugin-collection-sources
 */

import { renamedSlug } from "../../../../plugins/plugin-slug";

/** The part of a plugin definition the rule reads. */
interface ContributingPlugin {
  name: string;
  /** Each contributed slug the host renamed, to the slug it gave it. */
  renameMap?: Record<string, string>;
  contributes?: { collections?: readonly { slug: string }[] };
}

/**
 * `plugin:<name>` for each collection a plugin declares in
 * `contributes.collections`, by the slug the configuration holds it under: the
 * one the host renamed it to (`renameMap`), or the one the plugin declares. A
 * slug a rename vacated is free, so a collection the app declares there is the
 * app's. Any collection not listed is the app's own (`code`). Drives locking,
 * `nextly prune` and what `db:sync --remove-orphaned` deletes.
 *
 * `recorded`, where given, is a record of collections by slug that the registry
 * is written back to, such as a migration's snapshot: a collection the host
 * renamed since is found there by the slug the plugin declares. Where the
 * record holds the new slug, the rename was already made, and the vacated one
 * is the app's as in the configuration. One found by its declared slug outranks
 * a plugin contributing that slug now, which could take it only once it was
 * vacated.
 */
export function pluginCollectionSources(
  plugins: readonly ContributingPlugin[],
  recorded?: Readonly<Record<string, unknown>>
): Map<string, `plugin:${string}`> {
  const sources = new Map<string, `plugin:${string}`>();
  const beforeRename = new Map<string, `plugin:${string}`>();
  for (const plugin of plugins) {
    for (const contributed of plugin.contributes?.collections ?? []) {
      const renamed = renamedSlug(plugin, contributed.slug);
      const recordedAsDeclared =
        recorded !== undefined &&
        !Object.hasOwn(recorded, renamed) &&
        Object.hasOwn(recorded, contributed.slug);
      (recordedAsDeclared ? beforeRename : sources).set(
        recordedAsDeclared ? contributed.slug : renamed,
        `plugin:${plugin.name}`
      );
    }
  }
  // Last, so each outranks a plugin that took the vacated slug since, whichever is configured first.
  for (const [slug, source] of beforeRename) sources.set(slug, source);
  return sources;
}
