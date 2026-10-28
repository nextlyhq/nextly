/**
 * The collection tables a migration would drop: those the latest snapshot
 * holds that the configuration no longer declares.
 *
 * Its own module, apart from the check that judges them
 * (`removed-collections`), because most runs drop none: `migrate:create`
 * asks this first and loads the check, with the readers it needs, only when
 * there is something to judge.
 *
 * @module domains/schema/migrate-create/removed-collection-tables
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "./generate";

/** Every collection's table starts with this, whatever its slug or `dbName`. */
export const COLLECTION_TABLE_PREFIX = "dc_";

/**
 * The collection tables the latest snapshot holds that the configuration no
 * longer declares: the tables the next migration would drop.
 */
export function removedCollectionTables(input: {
  previous: NextlySchemaSnapshot;
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  dialect: SupportedDialect;
}): string[] {
  const desired = new Set(
    buildDesiredSnapshotFromConfig(
      input.collections,
      input.singles,
      input.components,
      input.dialect
    ).tables.map(table => table.name)
  );
  return input.previous.tables
    .map(table => table.name)
    .filter(
      name => name.startsWith(COLLECTION_TABLE_PREFIX) && !desired.has(name)
    );
}
