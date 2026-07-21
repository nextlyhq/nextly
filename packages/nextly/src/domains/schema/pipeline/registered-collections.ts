/**
 * Folding registry-only collections into a config-derived desired schema.
 *
 * Collections reach the database two ways: written in `nextly.config.ts`, or
 * created through the Schema Builder. Only the first kind is visible to code
 * that reads the config file. The second kind lives solely in the registry
 * table.
 *
 * That asymmetry matters because SQLite and MySQL ignore `tablesFilter` and
 * introspect the whole database, so a managed table absent from the desired
 * schema is not merely skipped — it is diffed as an orphan and emitted as a
 * DROP. A desired schema built from the config alone therefore proposes
 * deleting every Schema-Builder collection in the project.
 *
 * @module domains/schema/pipeline/registered-collections
 */

import type { DesiredCollection } from "./types";

/**
 * A registry row, kept structurally loose because callers reach the registry
 * through different surfaces (DI resolution, a CLI-constructed service, or a
 * partial fake in tests) and not all of them share a nominal type.
 */
export interface RegisteredCollectionRow {
  slug?: string;
  tableName?: string;
  fields?: unknown[];
  status?: boolean;
  localized?: boolean;
}

/** Logger slice used to report a registry that could not be read. */
interface WarnLogger {
  warn(message: string): void;
}

/**
 * Add registry-only collections to a config-derived desired schema.
 *
 * Config entries win: a collection defined in code is authoritative over the
 * registry row that mirrors it, so a field removed from the config is seen as
 * a removal rather than being resurrected from the registry.
 */
export function mergeRegisteredCollections(
  fromConfig: Record<string, DesiredCollection>,
  registered: readonly RegisteredCollectionRow[]
): Record<string, DesiredCollection> {
  const merged: Record<string, DesiredCollection> = { ...fromConfig };

  for (const row of registered) {
    if (!row?.slug || !row?.tableName) continue;
    if (merged[row.slug]) continue;

    merged[row.slug] = {
      slug: row.slug,
      tableName: row.tableName,
      fields: (row.fields ?? []) as DesiredCollection["fields"],
      status: row.status === true,
      // Carried so a localized Schema-Builder collection keeps translatable
      // columns out of its main table; without it the diff re-adds columns
      // that belong in the companion `_locales` table.
      localized: row.localized === true,
    };
  }

  return merged;
}

/**
 * Load registry rows and merge them, treating an unreadable registry as
 * non-fatal.
 *
 * The failure policy is deliberate and is the reason this wraps the merge
 * rather than leaving callers to do it. If the registry cannot be read we
 * proceed with the config-only schema, because refusing to sync at all would
 * be a worse outcome than syncing a subset. The caller is warned explicitly
 * that Schema-Builder collections may be flagged for drop on this pass, since
 * that is the consequence and it is not otherwise obvious from the output.
 */
export async function mergeRegisteredCollectionsSafely(
  fromConfig: Record<string, DesiredCollection>,
  loadRegistered: () => Promise<readonly RegisteredCollectionRow[]>,
  logger?: WarnLogger
): Promise<Record<string, DesiredCollection>> {
  try {
    return mergeRegisteredCollections(fromConfig, await loadRegistered());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(
      `Could not load registered collections (${message}). Collections ` +
        `created in the Schema Builder may be flagged for drop this pass.`
    );
    return { ...fromConfig };
  }
}
