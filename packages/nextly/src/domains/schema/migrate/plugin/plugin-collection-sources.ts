/**
 * Who contributed each code-first collection a plugin adds: the one rule the
 * start's code-first sync and `nextly migrate`'s registry writer give a
 * collection's registry row its origin by.
 *
 * @module domains/schema/migrate/plugin/plugin-collection-sources
 */

/** The part of a plugin definition the rule reads. */
interface ContributingPlugin {
  name: string;
  contributes?: { collections?: readonly { slug: string }[] };
}

/**
 * `plugin:<name>` for each collection a plugin declares in
 * `contributes.collections`, by slug. Any collection not listed is the app's
 * own (`code`). Drives locking and `nextly prune`.
 */
export function pluginCollectionSources(
  plugins: readonly ContributingPlugin[]
): Map<string, `plugin:${string}`> {
  const sources = new Map<string, `plugin:${string}`>();
  for (const plugin of plugins) {
    for (const contributed of plugin.contributes?.collections ?? []) {
      sources.set(contributed.slug, `plugin:${plugin.name}`);
    }
  }
  return sources;
}
