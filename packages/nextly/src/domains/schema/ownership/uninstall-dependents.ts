/**
 * What other owners built on, or into, the schema a full plugin uninstall
 * would drop.
 *
 * A full uninstall runs the plugin's DOWNs: they drop its tables and the
 * columns it contributed to other owners' tables. Anything another owner
 * built on those goes with them, so the uninstall refuses while any of it
 * remains (`planUninstall`). Five kinds are found:
 *
 * - **elements on the plugin's tables**: a column, index, foreign key or
 *   check the app or another plugin added;
 * - **foreign keys pointing in** from another owner's table;
 * - **relationship and upload fields** elsewhere that point at one of the
 *   plugin's collections;
 * - **elements using a column the plugin contributed** to another owner's
 *   table: an index or key the DOWN would break by dropping the column;
 * - **relations pointing in**: a relation edge on another owner's table that
 *   a relational query follows into one of the plugin's tables.
 *
 * Keys pointing in are read from the database's catalog too, so a key whose
 * declaration was removed from code while its constraint stayed is found.
 * A declaration answers for an element only while the database's element
 * matches it: an index, key or check whose declaration was changed in code
 * but never migrated is judged by the definition the database holds, and
 * one whose definition cannot be read is counted.
 *
 * The first three are the question a collection delete already asks
 * (`findEntityDependents`), asked here over the plugin's tables. The
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
  findEntityDependents,
  type DependentsSources,
} from "../../collections/services/collection-dependents";
import { enumCheckName } from "../extension/enum-check";
import type { ExtensionIndex } from "../extension/types";
import type { TableSpec } from "../pipeline/diff/types";
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
   * (entity slug to field name paths: a top-level name, or the dotted path
   * of one nested in a group or repeater), which go with it as well.
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
   * Every table the database holds now, with its indexes, foreign keys and
   * checks as its catalog reports them: what reads a key whose declaration
   * is gone but whose constraint is still there, and an element whose
   * declaration changed in code while the database kept the old one. A
   * dimension left `undefined` is one the catalog was not read for, and is
   * taken as unknown, never as empty. Throws rather than answering "none"
   * about a catalog it could not read. Read once per question.
   */
  liveSchema: () => Promise<readonly LiveTable[]>;
}

/** A table as the database's catalog reports it, with the elements on it. */
export type LiveTable = Pick<
  TableSpec,
  "name" | "indexes" | "foreignKeys" | "checks"
>;

/** A foreign key the database holds, as its catalog reports it. */
interface LiveForeignKey {
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

/**
 * An element as it is defined, compiled or live: the columns of the table it
 * is asked about that it uses.
 */
interface ElementUse {
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
}

/** A compiled element, with the owner its declaration names. */
interface CompiledUser extends ElementUse {
  owner: ElementOnTable["owner"];
}

/** A name as a database that may fold its case compares it. */
const folded = (name: string): string => name.toLowerCase();

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

/** Whether an element uses `column`, by its columns or its expression. */
function usesColumn(user: ElementUse, column: string): boolean {
  return (
    user.columns.some(used => folded(used) === folded(column)) ||
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
 * How an index on `table` uses its columns, by its column list and any
 * expression or predicate: one reading for a declared index and for one the
 * database holds.
 */
function indexUse(
  table: string,
  index: {
    name: string;
    columns: readonly string[];
    expression?: string;
    where?: string;
  }
): ElementUse {
  return {
    kind: "index",
    name: index.name,
    table,
    columns: index.columns,
    expression: indexExpression(index),
  };
}

/** How a check on `table` uses its columns: by its expression, which lists none. */
function checkUse(
  table: string,
  check: { name: string; sql: string }
): ElementUse {
  return {
    kind: "check",
    name: check.name,
    table,
    columns: [],
    expression: check.sql,
  };
}

/**
 * How a foreign key on `table` uses that table's columns: its own, and the
 * ones it references when it points back into the table it is on.
 */
function keyUse(
  table: string,
  key: {
    name: string;
    columns: readonly string[];
    referencesTable: string;
    referencesColumns: readonly string[];
  }
): ElementUse {
  return {
    kind: "fk",
    name: key.name,
    table,
    columns: [
      ...key.columns,
      ...(folded(key.referencesTable) === folded(table)
        ? key.referencesColumns
        : []),
    ],
  };
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
    ...indexUse(table, {
      ...index,
      name: index.name ?? nameIndex(table, index),
    }),
    owner: index.contributedBy ?? tableOwner,
  }));
  const spec = schema.specs.find(candidate => candidate.name === table);
  const declared = (spec?.indexes ?? []).map(index => ({
    ...indexUse(table, index),
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
    ...checkUse(table, check),
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
    ...keyUse(table, key),
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
  const onTables = await findEntityDependents(
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
  // A field it added is matched by its whole path, or by a field on that
  // path it added: a relationship nested in a group its `extend` added is
  // that group's, and one its transform put inside another owner's group is
  // recorded by its own path. A field matched by neither stays its entity
  // owner's and counts, so a path recorded some other way refuses rather
  // than drops.
  const addedByIt = (field: { entitySlug: string; fieldPath: string }) => {
    const added = extended?.get(field.entitySlug);
    if (added === undefined) return false;
    const names = field.fieldPath.split(".");
    return names.some((_, at) => added.has(names.slice(0, at + 1).join(".")));
  };
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
 * The indexes, keys and checks the database holds on one table, by how each
 * uses its columns, keyed by kind and by name as a database that may fold
 * case compares them. `unread` names the kinds its catalog was not read for.
 */
interface LiveOnTable {
  uses: ReadonlyMap<string, ElementUse>;
  unread: ReadonlySet<ElementOnTable["kind"]>;
}

/** How `LiveOnTable` keys an element. */
const liveKey = (kind: string, name: string): string =>
  `${kind}\u0000${folded(name)}`;

/** What the database holds on `table`; `undefined` when it holds no such table. */
function liveOn(
  live: readonly LiveTable[],
  table: string
): LiveOnTable | undefined {
  const spec = live.find(candidate => folded(candidate.name) === folded(table));
  if (spec === undefined) return undefined;
  const uses = [
    ...(spec.indexes ?? []).map(index => indexUse(table, index)),
    ...(spec.foreignKeys ?? []).map(key => keyUse(table, key)),
    ...(spec.checks ?? []).map(check => checkUse(table, check)),
  ];
  const unread = new Set<ElementOnTable["kind"]>();
  if (spec.indexes === undefined) unread.add("index");
  if (spec.foreignKeys === undefined) unread.add("fk");
  if (spec.checks === undefined) unread.add("check");
  return {
    uses: new Map(uses.map(use => [liveKey(use.kind, use.name), use])),
    unread,
  };
}

/**
 * Whether the database's element under a declaration that does not use
 * `columnName` may use it all the same: a declaration changed in code and
 * never migrated leaves the old definition in place, and dropping the
 * column breaks that one. Said for the refusal, or `undefined` when the
 * database's element does not use the column or is not there. One whose
 * definition was not read may use it, so it counts. A key on another table
 * pointing into this one is read by `liveKeysPointingIn`.
 */
function liveUseBeyond(
  onTable: LiveOnTable | undefined,
  user: ElementUse,
  table: string,
  columnName: string
): string | undefined {
  if (onTable === undefined || user.table !== table) return undefined;
  if (onTable.unread.has(user.kind)) {
    return `whose definition in the database could not be read, so it may use column "${columnName}"`;
  }
  const live = onTable.uses.get(liveKey(user.kind, user.name));
  if (live === undefined || !usesColumn(live, columnName)) return undefined;
  return `which in the database still uses column "${columnName}", though its declaration does not`;
}

/**
 * Elements on a table that use one column the plugin contributed, other
 * than the plugin's own: by their declarations, and by the definitions the
 * database holds for them.
 */
function compiledUsersOf(
  compiled: ReturnType<typeof compiledColumnUsers>,
  onTable: LiveOnTable | undefined,
  pluginName: string,
  table: string,
  columnName: string,
  found: Found
): void {
  for (const user of compiled.values()) {
    if (isThePlugin(user.owner, pluginName)) continue;
    const how = usesColumn(user, columnName)
      ? howItUses(user, table, columnName)
      : liveUseBeyond(onTable, user, table, columnName);
    if (how === undefined) continue;
    found.add({
      kind: kindName(user.kind),
      name: user.name,
      table: user.table,
      owner: `${describeOwner(user.owner)}, ${how}`,
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
 * read. Counted, since the guard does not assume what it could not read. One
 * a declaration does describe is left to `compiledUsersOf`, which judges it
 * by that declaration and by the definition the database holds.
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
  live: () => Promise<readonly LiveTable[]>,
  found: Found
): Promise<void> {
  const contributed = contributedColumnsOf(input.owned, own);
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
  const tables = await live();
  for (const column of contributed) {
    const columnName = column.elementName ?? "";
    const compiled = compiledColumnUsers(
      schema,
      column.tableName,
      resolveIndexName
    );
    compiledUsersOf(
      compiled,
      liveOn(tables, column.tableName),
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
  // One read of the catalog answers both live questions below.
  let read: Promise<readonly LiveTable[]> | undefined;
  const live = () => (read ??= input.liveSchema());
  await onItsTables(input, ownTables, found);
  await relationsPointingIn(input, new Set(ownTables), found);
  await onItsContributedColumns(input, new Set(ownTables), live, found);
  await liveKeysPointingIn(input, new Set(ownTables), live, found);
  return found.list;
}

/**
 * Relation edges on other owners' tables that lead into the plugin's tables.
 *
 * A relation is no database element: it has no constraint the catalog
 * reports and no owner row, yet a relational query through it fails once
 * the table it leads to is dropped, and the plugin that declared it asked
 * for the target among its dependencies to rely on it staying. Read from
 * the compiled schema, which holds disabled plugins' tables and edges as it
 * holds enabled ones': turning a plugin off withholds its code, not its
 * schema, and enabling it again brings its queries back. A relation another
 * owner added to a third table is named under that owner. Compared as a
 * database that may fold case compares table names.
 */
async function relationsPointingIn(
  input: UninstallDependentsInput,
  own: ReadonlySet<string>,
  found: Found
): Promise<void> {
  if (own.size === 0) return;
  const schema = await input.sources.extensionSchema();
  if (schema === null) return;
  const ownFolded = new Set([...own].map(folded));
  const declared = new Map(
    (schema.tables ?? []).map(table => [table.name, table])
  );
  const edges = [
    ...(schema.relations ?? new Map()),
    ...(schema.adoptedRelations ?? new Map()),
  ];
  for (const [table, list] of edges) {
    if (ownFolded.has(folded(table))) continue;
    for (const edge of list) {
      if (!ownFolded.has(folded(edge.targetTable))) continue;
      const contributor = declared
        .get(table)
        ?.relations?.find(
          relation => relation.name === edge.key
        )?.contributedBy;
      const owner = contributor ?? schema.owners.get(table);
      if (owner !== undefined && isThePlugin(owner, input.pluginName)) {
        continue;
      }
      found.add({
        kind: "relation",
        name: edge.key,
        table,
        owner: owner === undefined ? "its schema" : describeOwner(owner),
      });
    }
  }
}

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
 * and that no compiled declaration accounts for. Dropping a key's target
 * strips the key on PostgreSQL (`CASCADE`) and refuses part way on MySQL, so
 * each counts like a declared one. Two kinds:
 *
 * - a key nothing compiled declares: a declaration removed from code whose
 *   constraint was never migrated away. One whose ownership record names
 *   the plugin is its own; any other is counted, and one with no record at
 *   all is counted as having an owner nothing records: the guard does not
 *   assume an answer it could not read;
 * - a key a declaration names (its table and name) that references another
 *   table or other columns than the database's key does: a declaration
 *   retargeted in code and never migrated. Counted under the declaration's
 *   owner, unless that is the plugin.
 *
 * A key whose declaration matches it is found from that declaration, and is
 * not read a second time here.
 */
async function liveKeysPointingIn(
  input: UninstallDependentsInput,
  own: ReadonlySet<string>,
  live: () => Promise<readonly LiveTable[]>,
  found: Found
): Promise<void> {
  const contributed = contributedColumnsOf(input.owned, own);
  if (own.size === 0 && contributed.length === 0) return;
  const pointing = keysPointingIn(liveKeysOf(await live()), own, contributed);
  if (pointing.length === 0) return;
  const { undeclared, retargeted } = unaccountedKeys(
    await input.sources.extensionSchema(),
    pointing
  );
  for (const { key, declared } of retargeted) {
    if (isThePlugin(declared.owner, input.pluginName)) continue;
    found.add({
      kind: "foreign key",
      name: key.name,
      table: key.table,
      owner: `${describeOwner(declared.owner)}, declared to reference ${targetOf(declared)}, while the key the database holds references ${targetOf(key)}`,
    });
  }
  if (undeclared.length === 0) return;
  const recorded = elementsFromOwnerRows(
    await input.recordedRowsOn([...new Set(undeclared.map(key => key.table))])
  );
  for (const key of undeclared) {
    const owner = recordedOwnerOf(recorded, key);
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

/** Every foreign key the live tables hold, with the table each is on. */
function liveKeysOf(tables: readonly LiveTable[]): LiveForeignKey[] {
  return tables.flatMap(table =>
    (table.foreignKeys ?? []).map(key => ({
      table: table.name,
      name: key.name,
      referencesTable: key.referencesTable,
      referencesColumns: key.referencesColumns,
    }))
  );
}

/** The plugin's column rows on other owners' tables: the columns it contributed. */
function contributedColumnsOf(
  owned: readonly OwnerRecord[],
  own: ReadonlySet<string>
): OwnerRecord[] {
  return owned.filter(
    row => row.elementKind === "column" && !own.has(row.tableName)
  );
}

/** What a key references: a table and its columns, in order. */
interface KeyTarget {
  referencesTable: string;
  referencesColumns: readonly string[];
}

/** A key's target as the refusal names it. */
const targetOf = (target: KeyTarget): string =>
  `"${target.referencesTable}" (${target.referencesColumns.join(", ")})`;

/** Whether two keys reference the same table and columns, in order. */
function sameTarget(a: KeyTarget, b: KeyTarget): boolean {
  return (
    folded(a.referencesTable) === folded(b.referencesTable) &&
    a.referencesColumns.length === b.referencesColumns.length &&
    a.referencesColumns.every(
      (column, at) => folded(column) === folded(b.referencesColumns[at] ?? "")
    )
  );
}

/** A live key whose declaration, found by its table and name, references something else. */
interface RetargetedKey {
  key: LiveForeignKey;
  declared: KeyTarget & { owner: ElementOnTable["owner"] };
}

/**
 * The live keys among `keys` that compiled declarations do not account
 * for: those no declaration names by table and name, and those whose
 * declaration references another table or other columns.
 */
function unaccountedKeys(
  schema: ExtensionSchemaRecord | null,
  keys: readonly LiveForeignKey[]
): { undeclared: LiveForeignKey[]; retargeted: RetargetedKey[] } {
  if (schema === null) return { undeclared: [...keys], retargeted: [] };
  const declared = new Map<string, RetargetedKey["declared"]>();
  for (const spec of schema.specs) {
    for (const key of spec.foreignKeys ?? []) {
      declared.set(`${folded(spec.name)}\u0000${folded(key.name)}`, {
        referencesTable: key.referencesTable,
        referencesColumns: key.referencesColumns,
        // Its contributor's when it was added to another owner's table, as
        // `foreignKeysInto` reads a declared key's owner.
        owner: contributorOf(schema, spec.name, "fk", key.name) ??
          schema.owners.get(spec.name) ?? { kind: "app" },
      });
    }
  }
  const undeclared: LiveForeignKey[] = [];
  const retargeted: RetargetedKey[] = [];
  for (const key of keys) {
    const declaration = declared.get(
      `${folded(key.table)}\u0000${folded(key.name)}`
    );
    if (declaration === undefined) {
      undeclared.push(key);
    } else if (!sameTarget(declaration, key)) {
      retargeted.push({ key, declared: declaration });
    }
  }
  return { undeclared, retargeted };
}

/** Who the ownership record names as a live key's owner, if it records one. */
function recordedOwnerOf(
  recorded: readonly ElementOnTable[],
  key: LiveForeignKey
): ElementOnTable["owner"] | undefined {
  return recorded.find(
    element =>
      element.kind === "fk" &&
      folded(element.table) === folded(key.table) &&
      folded(element.name) === folded(key.name)
  )?.owner;
}

/**
 * The fields `pluginName` added to other owners' entities, by entity slug
 * and field name path: the top-level ones its `extend` clauses declare, and
 * those, at any depth, the fold's ownership ledgers record it adding, by
 * `extend` or a transform.
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
  /** Entity slug to the field name paths it added there, by `extend` or a transform. */
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
