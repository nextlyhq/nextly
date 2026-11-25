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
  slug?: unknown;
  source?: unknown;
}

/** What a kind is called in the line, and whether `nextly prune` takes it. */
const KINDS = {
  collection: { named: "collection(s)", pruned: true },
  single: { named: "single(s)", pruned: false },
  component: { named: "component(s)", pruned: false },
} as const;

/**
 * The way to remove them, as a sentence. A migration drops every kind on a site that keeps
 * migration files, where what `nextly prune` dropped directly would leave `nextly migrate` refusing
 * a database its ledger no longer matches. Empty where there is no way, or where whether the site
 * keeps them cannot be read: the line only informs, so that stops no sync.
 */
async function wayToRemove(
  pruned: boolean,
  keepsMigrationFiles: () => Promise<boolean>
): Promise<string> {
  const migrations = await keepsMigrationFiles().catch(() => undefined);
  if (migrations === true) {
    return ' "nextly migrate:create" writes the migration that drops them, and "nextly migrate" applies it with your consent.';
  }
  return migrations === false && pruned
    ? ' "nextly prune" lists these collections, and removes them with --accept-data-loss.'
    : "";
}

const PLUGIN_PREFIX = "plugin:";

/**
 * Names each of `rows` a plugin owns and the configuration does not declare.
 * Says nothing where there is none.
 */
export async function reportKeptPluginEntities(
  kind: keyof typeof KINDS,
  rows: readonly RecordedRow[],
  declared: readonly { slug: string }[],
  report: {
    logger: Pick<CommandContext["logger"], "newline" | "info" | "item">;
    /** Asked only where there is an entity to name. */
    keepsMigrationFiles: () => Promise<boolean>;
  }
): Promise<void> {
  const slugs = new Set(declared.map(entity => entity.slug));
  const kept = rows.flatMap(({ slug, source }) =>
    typeof slug === "string" &&
    typeof source === "string" &&
    source.startsWith(PLUGIN_PREFIX) &&
    !slugs.has(slug)
      ? [`${slug} (${source.slice(PLUGIN_PREFIX.length)})`]
      : []
  );
  if (kept.length === 0) return;
  const { named, pruned } = KINDS[kind];
  const { logger } = report;
  const way = await wayToRemove(pruned, report.keepsMigrationFiles);
  logger.newline();
  logger.info(
    `${kept.length} ${named} kept, contributed by a plugin and no longer in your config:`
  );
  for (const line of kept) logger.item(line, 1);
  logger.info(`--remove-orphaned leaves them as they are.${way}`);
}
