/**
 * What other owners built on, or into, the schema a full plugin uninstall
 * would drop.
 *
 * A full uninstall runs the plugin's DOWNs: they drop its tables and the
 * columns it contributed to other owners' tables. Anything another owner
 * built on those goes with them, so the uninstall refuses while any of it
 * remains (`planUninstall`). Four kinds are found:
 *
 * - **elements on the plugin's tables**: a column, index, foreign key or
 *   check the app or another plugin added;
 * - **foreign keys pointing in** from another owner's table;
 * - **relationship and upload fields** elsewhere that point at one of the
 *   plugin's collections;
 * - **elements using a column the plugin contributed** to another owner's
 *   table: an index or key the DOWN would break by dropping the column.
 *
 * The first three are the question a collection delete already asks
 * (`findCollectionDependents`), asked here over the plugin's tables. The
 * recorded element rows outlive the configuration that declared them, so a
 * disabled or removed owner's retained elements are found too. Where a
 * recorded element on a table the plugin contributed a column to cannot be
 * described (its owner is no longer configured, so nothing says which
 * columns it uses), it is counted: a guard against deleting someone else's
 * data does not assume the answer it could not read.
 *
 * Every read answers or throws; a throw makes the uninstall refuse.
 *
 * @module domains/schema/ownership/uninstall-dependents
 */

import type { PluginDefinition } from "../../../plugins/plugin-context";
import { resolvePluginSelf } from "../../../plugins/self";
import {
  findCollectionDependents,
  type DependentsSources,
} from "../../collections/services/collection-dependents";
import { resolveCollectionTableName } from "../utils/resolve-table-name";

import {
  describeOwner,
  elementsFromOwnerRows,
  foreignKeysInto,
  type ElementOnTable,
  type ExtensionSchemaRecord,
} from "./dependent-elements";
import { ownerRecordKey, type OwnerRecord } from "./owner-registry";
import type { UninstallDependent } from "./uninstall-plan";

/** How the refusal names a kind of element. */
const KIND_NAMES: Record<string, string> = {
  column: "column",
  index: "index",
  fk: "foreign key",
  check: "check",
};

/** What finding the dependents reads. */
export interface UninstallDependentsInput {
  pluginName: string;
  /** The plugin's live owner rows: its tables, and the columns it contributed elsewhere. */
  owned: readonly OwnerRecord[];
  /** The slugs of the plugin's own collections, whose fields go with it. */
  collectionSlugs: readonly string[];
  /**
   * Its own Singles and field groups, whose fields go with it too, and the
   * fields its `extend` clauses added to other owners' entities (entity slug
   * to top-level field names), which go with it as well.
   */
  ownEntities?: {
    single?: readonly string[];
    fieldGroup?: readonly string[];
    extendedFields?: ReadonlyMap<string, ReadonlySet<string>>;
  };
  /** The collection a table holds, so fields pointing at it are found; `null` for a plain table. */
  collectionSlugForTable: (table: string) => string | null;
  /** Fields, the compiled extension schema, and recorded element rows. */
  sources: DependentsSources;
  /** The owner rows recorded on these tables, every owner's. */
  recordedRowsOn: (tables: readonly string[]) => Promise<OwnerRecord[]>;
}

/** Whether an owner is the plugin being uninstalled. */
function isThePlugin(
  owner: ElementOnTable["owner"],
  pluginName: string
): boolean {
  return owner.kind === "plugin" && owner.id === pluginName;
}

/** A compiled element, and the columns of the table it is asked about that it uses. */
interface CompiledUser {
  kind: ElementOnTable["kind"];
  name: string;
  /** The table the element is on: the asked-about table, or one whose key points into it. */
  table: string;
  columns: readonly string[];
  owner: ElementOnTable["owner"];
}

/** Who contributed an element to `table`, when the compiled schema records one. */
function contributorOf(
  schema: ExtensionSchemaRecord,
  table: string,
  kind: string,
  name: string
): ElementOnTable["owner"] | undefined {
  return schema.elementOwners
    .get(table)
    ?.find(
      element => element.elementKind === kind && element.elementName === name
    )?.owner;
}

/** The indexes on `table`, an entity's and a declared table's, by their columns. */
function indexUsers(
  schema: ExtensionSchemaRecord,
  table: string,
  tableOwner: ElementOnTable["owner"]
): CompiledUser[] {
  const onEntity = (schema.entityIndexes.get(table) ?? []).flatMap(index =>
    index.name === undefined
      ? []
      : [
          {
            kind: "index" as const,
            name: index.name,
            table,
            columns: index.columns,
            owner: index.contributedBy ?? tableOwner,
          },
        ]
  );
  const spec = schema.specs.find(candidate => candidate.name === table);
  const declared = (spec?.indexes ?? []).map(index => ({
    kind: "index" as const,
    name: index.name,
    table,
    columns: index.columns,
    owner: contributorOf(schema, table, "index", index.name) ?? tableOwner,
  }));
  return [...onEntity, ...declared];
}

/**
 * The foreign keys on `table`, by their own columns, and those pointing into
 * it, on it or on another table, by the columns they reference. Keys from
 * other tables carry their owners as `foreignKeysInto` reads them.
 */
function keyUsers(
  schema: ExtensionSchemaRecord,
  table: string,
  tableOwner: ElementOnTable["owner"]
): CompiledUser[] {
  const spec = schema.specs.find(candidate => candidate.name === table);
  const own = (spec?.foreignKeys ?? []).map(key => ({
    kind: "fk" as const,
    name: key.name,
    table,
    columns: [
      ...key.columns,
      ...(key.referencesTable === table ? key.referencesColumns : []),
    ],
    owner: contributorOf(schema, table, "fk", key.name) ?? tableOwner,
  }));
  const inbound = foreignKeysInto(schema, new Set([table])).map(key => ({
    kind: "fk" as const,
    name: key.name,
    table: key.table,
    columns:
      schema.specs
        .find(candidate => candidate.name === key.table)
        ?.foreignKeys?.find(candidate => candidate.name === key.name)
        ?.referencesColumns ?? [],
    owner: key.owner,
  }));
  return [...own, ...inbound];
}

/**
 * Every compiled element that uses columns of `table`, keyed as the owner
 * registry keys an element (`ownerRecordKey`: table, kind and name), so an
 * index and a foreign key that share a name on one table, as SQLite allows,
 * stay two. Listed by two sources (a contributed index the spec carries
 * too), an element uses every column either says it does.
 */
function compiledColumnUsers(
  schema: ExtensionSchemaRecord | null,
  table: string
): Map<string, CompiledUser> {
  const users = new Map<string, CompiledUser>();
  if (schema === null) return users;
  const tableOwner = schema.owners.get(table) ?? { kind: "app" as const };
  for (const user of [
    ...indexUsers(schema, table, tableOwner),
    ...keyUsers(schema, table, tableOwner),
  ]) {
    const key = ownerRecordKey({
      tableName: user.table,
      elementKind: user.kind,
      elementName: user.name,
    });
    const known = users.get(key);
    users.set(
      key,
      known === undefined
        ? user
        : { ...known, columns: [...known.columns, ...user.columns] }
    );
  }
  return users;
}

/** Dependents found, each once, in the order found. */
class Found {
  readonly list: UninstallDependent[] = [];
  private readonly seen = new Set<string>();

  add(dependent: UninstallDependent): void {
    const key = `${dependent.kind}\u0000${dependent.table}\u0000${dependent.name}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push(dependent);
  }
}

/** How the refusal names a kind of element. */
const kindName = (kind: string): string => KIND_NAMES[kind] ?? kind;

/** The plugin's own tables: its table rows, once each. */
function ownTablesOf(owned: readonly OwnerRecord[]): string[] {
  return [
    ...new Set(
      owned
        .filter(row => (row.elementKind ?? "table") === "table")
        .map(row => row.tableName)
    ),
  ];
}

/**
 * Elements on its tables, keys pointing in, and fields pointing at its
 * collections: the question a collection delete asks, over these tables.
 */
async function onItsTables(
  input: UninstallDependentsInput,
  ownTables: readonly string[],
  found: Found
): Promise<void> {
  const onTables = await findCollectionDependents(
    ownTables.map(table => ({
      slug: table,
      tables: [table],
      fieldSlug: input.collectionSlugForTable(table),
    })),
    input.sources,
    { fieldsGoWith: input.collectionSlugs }
  );
  const ownSingles = new Set(input.ownEntities?.single ?? []);
  const ownGroups = new Set(input.ownEntities?.fieldGroup ?? []);
  const extended = input.ownEntities?.extendedFields;
  // A field its `extend` added is matched by the top-level field the clause
  // declared: a relationship nested in a group it added is that group's.
  const addedByIt = (field: { entitySlug: string; fieldPath: string }) =>
    extended?.get(field.entitySlug)?.has(field.fieldPath.split(".")[0]) ===
    true;
  for (const dependents of onTables.values()) {
    const othersFields = dependents.fields.filter(
      field =>
        !(field.entityType === "single" && ownSingles.has(field.entitySlug)) &&
        !(
          field.entityType === "fieldGroup" && ownGroups.has(field.entitySlug)
        ) &&
        !addedByIt(field)
    );
    for (const field of othersFields) {
      found.add({
        kind: "relationship field",
        name: field.fieldPath,
        table: `${field.entityType} "${field.entitySlug}"`,
        owner: "its schema",
      });
    }
    const others = [
      ...dependents.foreignKeys.map(key => ({ ...key, kind: "fk" })),
      ...dependents.elements,
    ].filter(item => !isThePlugin(item.owner, input.pluginName));
    for (const item of others) {
      found.add({
        kind: kindName(item.kind),
        name: item.name,
        table: item.table,
        owner: describeOwner(item.owner),
      });
    }
  }
}

/**
 * Compiled elements on a table that use one column the plugin contributed,
 * other than the plugin's own.
 */
function compiledUsersOf(
  compiled: ReturnType<typeof compiledColumnUsers>,
  pluginName: string,
  table: string,
  columnName: string,
  found: Found
): void {
  for (const user of compiled.values()) {
    if (isThePlugin(user.owner, pluginName)) continue;
    if (!user.columns.includes(columnName)) continue;
    found.add({
      kind: kindName(user.kind),
      name: user.name,
      table: user.table,
      owner:
        user.table === table
          ? `${describeOwner(user.owner)}, using column "${columnName}"`
          : `${describeOwner(user.owner)}, referencing column "${table}.${columnName}"`,
    });
  }
}

/**
 * A recorded index, key or check on the table that nothing compiled
 * describes: its owner is not configured, so which columns it uses cannot be
 * read. Counted, since the guard does not assume what it could not read.
 */
function undescribedOn(
  recorded: readonly ElementOnTable[],
  compiled: ReturnType<typeof compiledColumnUsers>,
  pluginName: string,
  table: string,
  columnName: string,
  found: Found
): void {
  const undescribed = recorded.filter(
    element =>
      element.table === table &&
      element.kind !== "column" &&
      !isThePlugin(element.owner, pluginName) &&
      !compiled.has(
        ownerRecordKey({
          tableName: element.table,
          elementKind: element.kind,
          elementName: element.name,
        })
      )
  );
  for (const element of undescribed) {
    found.add({
      kind: kindName(element.kind),
      name: element.name,
      table: element.table,
      owner: `${describeOwner(element.owner)}, which may use column "${columnName}" (its owner is not configured, so its columns cannot be read)`,
    });
  }
}

/**
 * Elements using a column the plugin contributed to another owner's table:
 * its DOWN drops the column out from under them.
 */
async function onItsContributedColumns(
  input: UninstallDependentsInput,
  own: ReadonlySet<string>,
  found: Found
): Promise<void> {
  const contributed = input.owned.filter(
    row => row.elementKind === "column" && !own.has(row.tableName)
  );
  if (contributed.length === 0) return;
  const schema = await input.sources.extensionSchema();
  const recorded = elementsFromOwnerRows(
    await input.recordedRowsOn([
      ...new Set(contributed.map(row => row.tableName)),
    ])
  );
  for (const column of contributed) {
    const columnName = column.elementName ?? "";
    const compiled = compiledColumnUsers(schema, column.tableName);
    compiledUsersOf(
      compiled,
      input.pluginName,
      column.tableName,
      columnName,
      found
    );
    undescribedOn(
      recorded,
      compiled,
      input.pluginName,
      column.tableName,
      columnName,
      found
    );
  }
}

/**
 * Everything another owner built on or into the plugin's schema, each named
 * for the refusal. Empty when nothing is.
 */
export async function findUninstallDependents(
  input: UninstallDependentsInput
): Promise<UninstallDependent[]> {
  const ownTables = ownTablesOf(input.owned);
  const found = new Found();
  await onItsTables(input, ownTables, found);
  await onItsContributedColumns(input, new Set(ownTables), found);
  return found.list;
}

/** What a plugin owns, by the names its rows and fields use. */
export interface PluginEntities {
  /** Its collections' slugs, after a host's renames. */
  collectionSlugs: string[];
  /** The collection a table holds, or `null` for a table of its own schema. */
  collectionSlugForTable: (table: string) => string | null;
  single: string[];
  /** Its field groups' slugs, after a host's renames. */
  fieldGroup: string[];
  /** Entity slug to the top-level fields its `extend` clauses added there. */
  extendedFields: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The collections, Singles and field groups a plugin owns, under the names
 * it is stored by: a host's `renameMap` is applied, so a field elsewhere
 * that names a renamed collection is matched to it. And the fields its
 * `extend` clauses added to other owners' entities, which leave with it.
 *
 * Field groups are renamed, and the extended fields read, by the schema
 * fold's own functions, so they are named here as the fold stored them.
 */
export async function pluginEntities(
  definition: PluginDefinition | undefined
): Promise<PluginEntities> {
  if (definition === undefined) {
    return {
      collectionSlugs: [],
      collectionSlugForTable: () => null,
      single: [],
      fieldGroup: [],
      extendedFields: new Map(),
    };
  }
  // Loaded when asked: the fold is not otherwise needed to find dependents.
  const { extendersBySlug, renamePluginContributes } = await import(
    "../../../plugins/schema/apply-contributions"
  );
  const self = resolvePluginSelf(definition);
  const resolved = (declared: string): string =>
    self.collections[declared] ?? declared;
  const configs = [
    ...(definition.contributes?.collections ?? []),
    ...(definition.collections ?? []),
  ];
  const slugByTable = new Map(
    configs.map(collection => [
      resolveCollectionTableName(resolved(collection.slug), collection.dbName),
      resolved(collection.slug),
    ])
  );
  const extendedFields = new Map<string, ReadonlySet<string>>(
    [...extendersBySlug([definition])].map(([slug, fields]) => [
      slug,
      new Set(fields.keys()),
    ])
  );
  return {
    collectionSlugs: configs.map(collection => resolved(collection.slug)),
    collectionSlugForTable: table => slugByTable.get(table) ?? null,
    single: Object.values(self.singles),
    fieldGroup: (renamePluginContributes(definition).fieldGroups ?? []).map(
      group => group.slug
    ),
    extendedFields,
  };
}
