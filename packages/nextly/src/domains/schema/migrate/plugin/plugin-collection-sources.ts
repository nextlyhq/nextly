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
 */
export function pluginCollectionSources(
  plugins: readonly ContributingPlugin[]
): Map<string, `plugin:${string}`> {
  const sources = new Map<string, `plugin:${string}`>();
  for (const plugin of plugins) {
    for (const contributed of plugin.contributes?.collections ?? []) {
      sources.set(
        renamedSlug(plugin, contributed.slug),
        `plugin:${plugin.name}`
      );
    }
  }
  return sources;
}
