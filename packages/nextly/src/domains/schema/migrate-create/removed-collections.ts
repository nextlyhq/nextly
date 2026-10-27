/**
 * `migrate:create` writes no drop of a collection something still depends on.
 *
 * A code-first collection removed from the configuration leaves the latest
 * snapshot holding its table, and the next migration drops it. While a
 * remaining field points at the collection, a plugin or the app declares a
 * foreign key to its table, or another owner's column or index is on it, that
 * drop would do on every database it is applied to what a delete is refused
 * for. So the generator is refused with the same message a delete gets,
 * before it compiles or writes anything.
 *
 * What the command can read decides what it checks. It connects to no
 * database, so the fields come from the configuration and the Builder's
 * definitions it is generating from, and the declared keys and other owners'
 * elements from the extension schema those declare; the element rows a
 * database records are for the commands that read one.
 *
 * @module domains/schema/migrate-create/removed-collections
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  assertNothingDependsOn,
  referencingFields,
  type FieldOwner,
} from "../../collections/services/collection-dependents";
import type { RemovedCollectionSeed } from "../../collections/services/collection-dependents-schema";
import { collectionOwnTables } from "../../dynamic-collections/services/collection-tables";
import type { ExtensionSchemaRecord } from "../ownership/dependent-elements";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { resolveCollectionTableName } from "../utils/resolve-table-name";

import {
  buildDesiredSnapshotFromConfig,
  type MinimalConfigEntity,
} from "./generate";

/** Every collection's table starts with this, whatever its slug or `dbName`. */
const COLLECTION_TABLE_PREFIX = "dc_";

/**
 * The collection tables the latest snapshot holds that the configuration no
 * longer declares: the tables the next migration would drop.
 */
function removedCollectionTables(input: {
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

/**
 * Refuse to generate a migration that drops a collection something still
 * depends on, or whose dependents cannot be read.
 *
 * A snapshot records tables, not slugs, so a removed collection is known by
 * its table; the slug a remaining field names it by is the one whose table
 * that is. A table no remaining field names keeps a slug read off the table,
 * which is what the message calls it.
 *
 * @param input.extensionSchema compiles the extension schema with the removed
 *   collections seeded, so a hook that still extends one of them says what it adds
 */
export async function assertRemovedCollectionsUnused(input: {
  previous: NextlySchemaSnapshot;
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  dialect: SupportedDialect;
  extensionSchema: (
    removed: readonly RemovedCollectionSeed[]
  ) => Promise<ExtensionSchemaRecord | null>;
}): Promise<void> {
  const removedTables = removedCollectionTables(input);
  if (removedTables.length === 0) return;

  const owners: FieldOwner[] = [
    ...input.collections.map(entity => ownerOf("collection", entity)),
    ...input.singles.map(entity => ownerOf("single", entity)),
    ...input.components.map(entity => ownerOf("fieldGroup", entity)),
  ];
  const slugOfTable = new Map<string, string>();
  for (const owner of owners) {
    for (const field of referencingFields(owner.fields)) {
      for (const slug of field.targets) {
        const table = resolveCollectionTableName(slug);
        if (removedTables.includes(table) && !slugOfTable.has(table)) {
          slugOfTable.set(table, slug);
        }
      }
    }
  }
  const removed: RemovedCollectionSeed[] = removedTables.map(tableName => ({
    slug:
      slugOfTable.get(tableName) ??
      tableName.slice(COLLECTION_TABLE_PREFIX.length),
    tableName,
  }));

  await assertNothingDependsOn(
    removed.map(collection => ({
      slug: collection.slug,
      // A removed collection's fields are gone with its configuration, so
      // its tables are named from its own table alone.
      tables: collectionOwnTables(collection.tableName, []),
    })),
    {
      fieldOwners: () => Promise.resolve(owners),
      extensionSchema: () => input.extensionSchema(removed),
      // No database is read: see the module's note.
      recordedElements: () => Promise.resolve([]),
    }
  );
}

function ownerOf(
  entityType: FieldOwner["entityType"],
  entity: MinimalConfigEntity
): FieldOwner {
  return { entityType, entitySlug: entity.slug, fields: entity.fields };
}
