/**
 * `migrate:create` writes no drop of a collection, Single or field group
 * something still depends on.
 *
 * An entity removed from the configuration leaves the latest snapshot holding
 * its table, and the next migration drops it. While a remaining field points
 * at the collection or places the field group, a plugin or the app declares a
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

import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import {
  assertNothingDependsOn,
  referencingFields,
  type FieldOwner,
} from "../../collections/services/collection-dependents";
import type { RemovedCollectionSeed } from "../../collections/services/collection-dependents-schema";
import { fieldGroupPlacements } from "../../field-groups/storage/field-group-placements";
import type { ExtensionSchemaRecord } from "../ownership/dependent-elements";
import { collectionOwnTables } from "../services/field-column-descriptor";
import {
  resolveCollectionTableName,
  resolveComponentTableName,
} from "../utils/resolve-table-name";

import {
  COLLECTION_TABLE_PREFIX,
  SINGLE_TABLE_PREFIX,
  type MinimalConfigEntity,
  type RemovedEntityTables,
} from "./generate";

/**
 * The collections Nextly provides itself, which a relationship or upload may
 * name without the configuration declaring them. The same two the Builder's
 * cross-file check and the plugin relation check accept. Only these: another
 * core table's name, such as `audit_log`, is no relationship's target, and a
 * collection of that slug is one like any other.
 */
const BUILT_IN_RELATION_TARGETS: ReadonlySet<string> = new Set([
  "users",
  "media",
]);

/**
 * Refuse to generate a migration that drops a collection, Single or field
 * group something still depends on, or whose dependents cannot be read.
 *
 * A removed field group is judged as a removed collection is, by the fields
 * that still place it; a removed Single by the keys and elements of other
 * owners alone, since no field names a Single.
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
export async function assertRemovedEntitiesUnused(input: {
  /** The entity tables the migration would drop (`removedEntityTables`). */
  removed: RemovedEntityTables;
  collections: MinimalConfigEntity[];
  singles: MinimalConfigEntity[];
  components: MinimalConfigEntity[];
  dialect: SupportedDialect;
  extensionSchema: (
    removed: readonly RemovedCollectionSeed[]
  ) => Promise<ExtensionSchemaRecord | null>;
}): Promise<void> {
  const { removed } = input;
  if (
    removed.collections.length === 0 &&
    removed.singles.length === 0 &&
    removed.fieldGroups.length === 0
  ) {
    return;
  }

  const owners = remainingFieldOwners(input);
  const collections = namedRemoved(
    removed.collections,
    targetsNoLongerConfigured(owners, input.collections),
    resolveCollectionTableName,
    COLLECTION_TABLE_PREFIX
  );
  // A field group is named by the fields that place it, as a collection is by
  // the fields that point at it; a Single by none, so its slug is read off its
  // table.
  const fieldGroups = namedRemoved(
    removed.fieldGroups,
    fieldGroupsNoLongerConfigured(owners, input.components),
    resolveComponentTableName,
    STORAGE_FORMAT.tablePrefix
  );
  const singles = removed.singles.map(tableName => ({
    slug: tableName.slice(SINGLE_TABLE_PREFIX.length),
    tableName,
  }));
  const seeds: RemovedCollectionSeed[] = [
    ...collections.named,
    ...singles.map(single => ({ ...single, kind: "single" as const })),
    ...fieldGroups.named.map(group => ({
      ...group,
      kind: "fieldGroup" as const,
    })),
  ];

  await assertNothingDependsOn(
    [
      ...collections.named.map(collection => ({
        slug: collection.slug,
        // A removed collection's fields are gone with its configuration, so
        // its tables are named from its own table alone.
        tables: collectionOwnTables(collection.tableName, []),
        // Fields are matched only against a slug a remaining field names; a
        // name read off the table is what the refusal calls it, nothing more.
        fieldSlug: collection.namedBy,
      })),
      ...collections.unplaced.map(slug => ({ slug, tables: [] })),
      // A Single's and a field group's tables are their own and their translation table, as
      // their deletes ask; the snapshot records neither's translation table, so it is named here.
      ...singles.map(single => ({
        kind: "single" as const,
        slug: single.slug,
        tables: collectionOwnTables(single.tableName, []),
      })),
      ...fieldGroups.named.map(group => ({
        kind: "fieldGroup" as const,
        slug: group.slug,
        tables: collectionOwnTables(group.tableName, []),
        fieldSlug: group.namedBy,
      })),
      ...fieldGroups.unplaced.map(slug => ({
        kind: "fieldGroup" as const,
        slug,
        tables: [],
      })),
    ],
    {
      fieldOwners: () => Promise.resolve(owners),
      extensionSchema: () => input.extensionSchema(seeds),
      // No database is read: see the module's note.
      recordedElements: () => Promise.resolve([]),
    },
    // No field goes with the drop: the removed entities are no longer
    // configured, so none of their fields is among the owners, and a slug
    // read off a removed table may be a surviving collection's.
    { fieldsGoWith: [] }
  );
}

/**
 * The removed tables of one kind, each with the slug it is called by, and the
 * gone slugs no removed table resolves to: a field naming one points at, or
 * places, an entity this migration removes under a table of its own, or none.
 * A gone slug is only asked about where a table of its kind is removed.
 */
function namedRemoved(
  removedTables: readonly string[],
  goneSlugs: ReadonlySet<string>,
  tableOf: (slug: string) => string,
  prefix: string
): { named: NamedRemovedCollection[]; unplaced: string[] } {
  if (removedTables.length === 0) return { named: [], unplaced: [] };
  const named = namedRemovedTables(removedTables, goneSlugs, tableOf, prefix);
  return {
    named,
    unplaced: [...goneSlugs].filter(
      slug => !named.some(entity => entity.namedBy === slug)
    ),
  };
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
 * one of Nextly's own (`BUILT_IN_RELATION_TARGETS`).
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
        if (!configured.has(slug) && !BUILT_IN_RELATION_TARGETS.has(slug)) {
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
 * Each removed table with the slug it is called by: the gone slug whose table
 * it is, where one is, else one read off the table, which no field is
 * matched against.
 *
 * @param tableOf the table a slug of this kind of entity resolves to
 * @param prefix the prefix every table of this kind starts with
 */
function namedRemovedTables(
  removedTables: readonly string[],
  goneSlugs: ReadonlySet<string>,
  tableOf: (slug: string) => string,
  prefix: string
): NamedRemovedCollection[] {
  const slugOfTable = new Map<string, string>();
  for (const slug of goneSlugs) {
    const table = tableOf(slug);
    if (removedTables.includes(table) && !slugOfTable.has(table)) {
      slugOfTable.set(table, slug);
    }
  }
  return removedTables.map(tableName => ({
    slug: slugOfTable.get(tableName) ?? tableName.slice(prefix.length),
    tableName,
    namedBy: slugOfTable.get(tableName) ?? null,
  }));
}

/**
 * The field groups remaining fields place that the configuration no longer
 * declares: each is placed in a table this migration removes, or in none.
 */
function fieldGroupsNoLongerConfigured(
  owners: readonly FieldOwner[],
  components: readonly MinimalConfigEntity[]
): Set<string> {
  const configured = new Set(components.map(entity => entity.slug));
  const gone = new Set<string>();
  for (const owner of owners) {
    for (const placement of fieldGroupPlacements(owner.fields)) {
      for (const slug of placement.slugs) {
        if (!configured.has(slug)) gone.add(slug);
      }
    }
  }
  return gone;
}

function ownerOf(
  entityType: FieldOwner["entityType"],
  entity: MinimalConfigEntity
): FieldOwner {
  return { entityType, entitySlug: entity.slug, fields: entity.fields };
}
