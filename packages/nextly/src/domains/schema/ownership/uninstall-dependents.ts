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
 * Keys pointing in are read from the database's catalog too, so a key whose
 * declaration was removed from code while its constraint stayed is found.
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
import type { FieldsAddedByPlugins } from "../../../plugins/schema/apply-contributions";
import { resolvePluginSelf } from "../../../plugins/self";
import {
  findCollectionDependents,
  type DependentsSources,
} from "../../collections/services/collection-dependents";
import { enumCheckName } from "../extension/enum-check";
import type { ExtensionIndex } from "../extension/types";
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
   * fields it added to other owners' entities by `extend` or a transform
   * (entity slug to top-level field names), which go with it as well.
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
  /**
   * Every foreign key the database holds now, on every table, as its catalog
   * reports it: what reads a key whose declaration is gone but whose
   * constraint is still there. Throws rather than answering "none" about a
   * catalog it could not read.
   */
  liveForeignKeys: () => Promise<readonly LiveForeignKey[]>;
}

/** A foreign key the database holds, as its catalog reports it. */
export interface LiveForeignKey {
  /** The table the key is on. */
  table: string;
  name: string;
  referencesTable: string;
  referencesColumns: readonly string[];
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
  /**
   * SQL it reads columns through: a check's expression, which lists no
   * columns, or an index's expression or predicate. The columns it uses
   * there are read from it (`expressionMayName`).
   */
  expression?: string;
  owner: ElementOnTable["owner"];
}

/** A name a column could have that an expression could only spell as a word. */
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * Whether an element's expression may use `column`: whether the column's name
 * appears in it as a word, quoted or not, in any case. An expression can
 * reach a column only by naming it, so one without the name cannot use it;
 * one that has it, even inside a string literal, counts. A column whose name
 * is not a plain word cannot be looked for that way, so every expression
 * counts as using it: the guard does not assume what it could not read.
 */
function expressionMayName(expression: string, column: string): boolean {
  if (!PLAIN_IDENTIFIER.test(column)) return true;
  const words = expression.match(/[A-Za-z_][A-Za-z0-9_$]*/g) ?? [];
  return words.some(word => word.toLowerCase() === column.toLowerCase());
}

/** Whether a compiled element uses `column`, by its columns or its expression. */
function usesColumn(user: CompiledUser, column: string): boolean {
  return (
    user.columns.includes(column) ||
    (user.expression !== undefined &&
      expressionMayName(user.expression, column))
  );
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

/** The name the compiler gives an index (`resolveIndexName`), handed in by the caller. */
type IndexNamer = (table: string, index: ExtensionIndex) => string;

/**
 * The SQL an index reads beyond its column list: an expression index's
 * expression, which it has in place of columns, and a partial index's
 * predicate. Read as a check's expression is (`expressionMayName`).
 */
function indexExpression(index: {
  expression?: string;
  where?: string;
}): string | undefined {
  const parts = [index.expression, index.where].filter(
    (part): part is string => part !== undefined && part !== ""
  );
  return parts.length === 0 ? undefined : parts.join(" ");
}

/**
 * The indexes on `table`, an entity's and a declared table's, by their
 * columns and any expression or predicate. An entity index declared without
 * a name is named as the compiler names it.
 */
function indexUsers(
  schema: ExtensionSchemaRecord,
  table: string,
  tableOwner: ElementOnTable["owner"],
  nameIndex: IndexNamer
): CompiledUser[] {
  const onEntity = (schema.entityIndexes.get(table) ?? []).map(index => ({
    kind: "index" as const,
    name: index.name ?? nameIndex(table, index),
    table,
    columns: index.columns,
    expression: indexExpression(index),
    owner: index.contributedBy ?? tableOwner,
  }));
  const spec = schema.specs.find(candidate => candidate.name === table);
  const declared = (spec?.indexes ?? []).map(index => ({
    kind: "index" as const,
    name: index.name,
    table,
    columns: index.columns,
    expression: indexExpression(index),
    owner: contributorOf(schema, table, "index", index.name) ?? tableOwner,
  }));
  return [...onEntity, ...declared];
}

/**
 * The checks on `table`: a declared table's, by their expressions, and the
 * one each enum column contributed to an entity's table implies, by that
 * column, under the name `enumCheckName` gives it.
 */
function checkUsers(
  schema: ExtensionSchemaRecord,
  table: string,
  tableOwner: ElementOnTable["owner"]
): CompiledUser[] {
  const spec = schema.specs.find(candidate => candidate.name === table);
  const declared = (spec?.checks ?? []).map(check => ({
    kind: "check" as const,
    name: check.name,
    table,
    columns: [],
    expression: check.sql,
    owner: contributorOf(schema, table, "check", check.name) ?? tableOwner,
  }));
  const ofEnums = (schema.entityColumns.get(table) ?? [])
    .filter(column => (column.enumValues ?? []).length > 0)
    .map(column => ({
      kind: "check" as const,
      name: enumCheckName(table, column),
      table,
      columns: [column.name],
      owner: column.contributedBy ?? tableOwner,
    }));
  return [...declared, ...ofEnums];
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
  table: string,
  nameIndex: IndexNamer
): Map<string, CompiledUser> {
  const users = new Map<string, CompiledUser>();
  if (schema === null) return users;
  const tableOwner = schema.owners.get(table) ?? { kind: "app" as const };
  for (const user of [
    ...indexUsers(schema, table, tableOwner, nameIndex),
    ...keyUsers(schema, table, tableOwner),
    ...checkUsers(schema, table, tableOwner),
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
        : {
            ...known,
            columns: [...known.columns, ...user.columns],
            expression: known.expression ?? user.expression,
          }
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
    if (!usesColumn(user, columnName)) continue;
    found.add({
      kind: kindName(user.kind),
      name: user.name,
      table: user.table,
      owner: `${describeOwner(user.owner)}, ${howItUses(user, table, columnName)}`,
    });
  }
}

/** How a compiled element uses a column the plugin contributed, for the refusal. */
function howItUses(
  user: CompiledUser,
  table: string,
  columnName: string
): string {
  if (user.table !== table)
    return `referencing column "${table}.${columnName}"`;
  if (user.columns.includes(columnName)) return `using column "${columnName}"`;
  return `whose expression names column "${columnName}" (its columns are read from its expression, so a mention counts)`;
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
  // Loaded when asked, as `elementsAddedTo` loads it: the index naming rule
  // lives beside the compiler, which nothing else here needs.
  const { resolveIndexName } = await import("../extension/compile");
  const schema = await input.sources.extensionSchema();
  const recorded = elementsFromOwnerRows(
    await input.recordedRowsOn([
      ...new Set(contributed.map(row => row.tableName)),
    ])
  );
  for (const column of contributed) {
    const columnName = column.elementName ?? "";
    const compiled = compiledColumnUsers(
      schema,
      column.tableName,
      resolveIndexName
    );
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
  await liveKeysPointingIn(input, new Set(ownTables), found);
  return found.list;
}

/** A name as a database that may fold its case compares it. */
const folded = (name: string): string => name.toLowerCase();

/**
 * The live keys, on tables the uninstall does not drop, that point into the
 * plugin's tables or reference a column it contributed to another owner's.
 */
function keysPointingIn(
  keys: readonly LiveForeignKey[],
  own: ReadonlySet<string>,
  contributed: readonly OwnerRecord[]
): LiveForeignKey[] {
  const ownFolded = new Set([...own].map(folded));
  const columnsOn = new Map<string, Set<string>>();
  for (const row of contributed) {
    const table = folded(row.tableName);
    const columns = columnsOn.get(table) ?? new Set<string>();
    columns.add(folded(row.elementName ?? ""));
    columnsOn.set(table, columns);
  }
  return keys.filter(
    key =>
      !ownFolded.has(folded(key.table)) &&
      (ownFolded.has(folded(key.referencesTable)) ||
        key.referencesColumns.some(
          column =>
            columnsOn.get(folded(key.referencesTable))?.has(folded(column)) ===
            true
        ))
  );
}

/**
 * Foreign keys the database holds that point into what the uninstall drops
 * and that nothing compiled declares: a declaration removed from code whose
 * constraint was never migrated away. Dropping its target strips the key on
 * PostgreSQL (`CASCADE`) and refuses part way on MySQL, so it counts like
 * a declared one. A declared key is found from its declaration, and is not
 * read a second time here. One whose ownership record names the plugin is
 * its own; any other is counted, and one with no record at all is counted
 * as having an owner nothing records: the guard does not assume an answer it
 * could not read.
 */
async function liveKeysPointingIn(
  input: UninstallDependentsInput,
  own: ReadonlySet<string>,
  found: Found
): Promise<void> {
  const contributed = input.owned.filter(
    row => row.elementKind === "column" && !own.has(row.tableName)
  );
  if (own.size === 0 && contributed.length === 0) return;
  const pointing = keysPointingIn(
    await input.liveForeignKeys(),
    own,
    contributed
  );
  if (pointing.length === 0) return;
  const schema = await input.sources.extensionSchema();
  const declared = new Set(
    (schema?.specs ?? []).flatMap(spec =>
      (spec.foreignKeys ?? []).map(
        key => `${folded(spec.name)}\u0000${folded(key.name)}`
      )
    )
  );
  const undeclared = pointing.filter(
    key => !declared.has(`${folded(key.table)}\u0000${folded(key.name)}`)
  );
  if (undeclared.length === 0) return;
  const recorded = elementsFromOwnerRows(
    await input.recordedRowsOn([...new Set(undeclared.map(key => key.table))])
  );
  for (const key of undeclared) {
    const owner = recorded.find(
      element =>
        element.kind === "fk" &&
        folded(element.table) === folded(key.table) &&
        folded(element.name) === folded(key.name)
    )?.owner;
    if (owner !== undefined && isThePlugin(owner, input.pluginName)) continue;
    found.add({
      kind: "foreign key",
      name: key.name,
      table: key.table,
      owner:
        owner === undefined
          ? "an owner nothing records: the key is in the database, but no configuration or ownership record declares it"
          : `${describeOwner(owner)}, which no longer declares it`,
    });
  }
}

/**
 * The top-level fields `pluginName` added to other owners' entities, by
 * entity slug: those its `extend` clauses declare, and those the fold's
 * ownership ledgers record it adding, by `extend` or a transform.
 */
function addedBy(
  pluginName: string,
  ...sources: ReadonlyArray<
    ReadonlyMap<string, ReadonlyMap<string, string>> | undefined
  >
): Map<string, ReadonlySet<string>> {
  const added = new Map<string, Set<string>>();
  for (const source of sources) {
    for (const [slug, fields] of source ?? []) {
      for (const [field, by] of fields) {
        if (by !== pluginName) continue;
        const onEntity = added.get(slug) ?? new Set<string>();
        onEntity.add(field);
        added.set(slug, onEntity);
      }
    }
  }
  return added;
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
  /** Entity slug to the top-level fields it added there, by `extend` or a transform. */
  extendedFields: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * The collections, Singles and field groups a plugin owns, under the names
 * it is stored by: a host's `renameMap` is applied, so a field elsewhere
 * that names a renamed collection is matched to it. And the fields it added
 * to other owners' entities, which leave with it: those its `extend` clauses
 * declare, and those `fieldsAdded` (the fold's ownership ledgers, which the
 * config loader carries out) records it adding, a transform's included.
 *
 * Field groups are renamed, and the extended fields read, by the schema
 * fold's own functions, so they are named here as the fold stored them.
 */
export async function pluginEntities(
  definition: PluginDefinition | undefined,
  fieldsAdded?: FieldsAddedByPlugins
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
  const extendedFields = addedBy(
    definition.name,
    extendersBySlug([definition]),
    fieldsAdded
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
