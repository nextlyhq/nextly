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

import { CORE_TABLE_NAMES } from "../../../schemas/core-schema";
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
 * its table, and a slug cannot be read back from one: a `dbName` makes the
 * table unrelated to the slug fields name the collection by. So a remaining
 * field is judged by what it points at. A target that is neither a configured
 * collection nor one of Nextly's own (`users`, `media`) points at a collection
 * this migration removes, or at none at all, and either way the drop would
 * leave it pointing at nothing. Where the target's table follows from its
 * slug, the refusal names the two together; where it does not, the field is
 * named under its target alone. A removed table no remaining field names keeps
 * a slug read off the table, which is what the message calls it.
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

  const owners = remainingFieldOwners(input);
  const goneTargets = targetsNoLongerConfigured(owners, input.collections);
  const removed = namedRemovedCollections(removedTables, goneTargets);
  // Targets whose table could not be told from their slug: each is one of
  // the removed collections under a name of its own, or nothing at all.
  const unplaced = [...goneTargets].filter(
    slug => !removed.some(collection => collection.namedBy === slug)
  );

  await assertNothingDependsOn(
    [
      ...removed.map(collection => ({
        slug: collection.slug,
        // A removed collection's fields are gone with its configuration, so
        // its tables are named from its own table alone.
        tables: collectionOwnTables(collection.tableName, []),
        // Fields are matched only against a slug a remaining field names; a
        // name read off the table is what the refusal calls it, nothing more.
        fieldSlug: collection.namedBy,
      })),
      ...unplaced.map(slug => ({ slug, tables: [] })),
    ],
    {
      fieldOwners: () => Promise.resolve(owners),
      extensionSchema: () => input.extensionSchema(removed),
      // No database is read: see the module's note.
      recordedElements: () => Promise.resolve([]),
    },
    // No field goes with the drop: the removed collections are no longer
    // configured, so none of their fields is among the owners, and a slug
    // read off a removed table may be a surviving collection's.
    { fieldsGoWith: [] }
  );
}

/** Every field list the migration keeps: the configured collections', Singles' and field groups'. */
function remainingFieldOwners(input: {
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
}): FieldOwner[] {
  return [
    ...input.collections.map(entity => ownerOf("collection", entity)),
    ...input.singles.map(entity => ownerOf("single", entity)),
    ...input.components.map(entity => ownerOf("fieldGroup", entity)),
  ];
}

/**
 * The collections remaining fields point at that are neither configured nor
 * one of Nextly's own, whose tables are core tables of the same name.
 */
function targetsNoLongerConfigured(
  owners: readonly FieldOwner[],
  collections: readonly MinimalConfigEntity[]
): Set<string> {
  const configured = new Set(collections.map(entity => entity.slug));
  const gone = new Set<string>();
  for (const owner of owners) {
    for (const field of referencingFields(owner.fields)) {
      for (const slug of field.targets) {
        if (!configured.has(slug) && !CORE_TABLE_NAMES.includes(slug)) {
          gone.add(slug);
        }
      }
    }
  }
  return gone;
}

/** A removed table, what it is called, and the slug remaining fields name it by, if any does. */
interface NamedRemovedCollection extends RemovedCollectionSeed {
  readonly namedBy: string | null;
}

/**
 * Each removed table with the slug it is called by: the target whose table
 * it is, where one is, else one read off the table, which no field is
 * matched against.
 */
function namedRemovedCollections(
  removedTables: readonly string[],
  goneTargets: ReadonlySet<string>
): NamedRemovedCollection[] {
  const slugOfTable = new Map<string, string>();
  for (const slug of goneTargets) {
    const table = resolveCollectionTableName(slug);
    if (removedTables.includes(table) && !slugOfTable.has(table)) {
      slugOfTable.set(table, slug);
    }
  }
  return removedTables.map(tableName => ({
    slug:
      slugOfTable.get(tableName) ??
      tableName.slice(COLLECTION_TABLE_PREFIX.length),
    tableName,
    namedBy: slugOfTable.get(tableName) ?? null,
  }));
}

function ownerOf(
  entityType: FieldOwner["entityType"],
  entity: MinimalConfigEntity
): FieldOwner {
  return { entityType, entitySlug: entity.slug, fields: entity.fields };
}
