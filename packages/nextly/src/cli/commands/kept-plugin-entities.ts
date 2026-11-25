/**
 * What `nextly db:sync` says of the entities a plugin contributed that the
 * configuration no longer holds: it keeps them, `--remove-orphaned` included,
 * and names each with its plugin, so none is taken for the app's own.
 *
 * @module cli/commands/kept-plugin-entities
 */

import type { CommandContext } from "../program";

/** A registry row, as far as this reads it. */
interface RecordedRow {
  slug: string;
  source?: string | null;
}

/** What a kind is called in the line, and the way its entities are removed where there is one. */
const KINDS = {
  collection: {
    named: "collection(s)",
    way: ' "nextly prune" lists these collections, and removes them with --accept-data-loss.',
  },
  single: { named: "single(s)", way: "" },
  component: { named: "component(s)", way: "" },
} as const;

const PLUGIN_PREFIX = "plugin:";

/**
 * Names each of `rows` a plugin owns and the configuration does not declare.
 * Says nothing where there is none.
 */
export function reportKeptPluginEntities(
  kind: keyof typeof KINDS,
  rows: readonly RecordedRow[],
  declared: readonly { slug: string }[],
  logger: Pick<CommandContext["logger"], "newline" | "info" | "item">
): void {
  const slugs = new Set(declared.map(entity => entity.slug));
  const kept = rows.flatMap(({ slug, source }) =>
    source?.startsWith(PLUGIN_PREFIX) === true && !slugs.has(slug)
      ? [`${slug} (${source.slice(PLUGIN_PREFIX.length)})`]
      : []
  );
  if (kept.length === 0) return;
  const { named, way } = KINDS[kind];
  logger.newline();
  logger.info(
    `${kept.length} ${named} kept, contributed by a plugin and no longer in your config:`
  );
  for (const line of kept) logger.item(line, 1);
  logger.info(`--remove-orphaned leaves them as they are.${way}`);
}
