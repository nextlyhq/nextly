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
import {
  findCollectionDependents,
  type DependentsSources,
} from "../../collections/services/collection-dependents";

import {
  describeOwner,
  elementsFromOwnerRows,
  type ElementOnTable,
  type ExtensionSchemaRecord,
} from "./dependent-elements";
import type { OwnerRecord } from "./owner-registry";
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

/** The columns each compiled element on `table` uses, by element name. */
function compiledColumnUsers(
  schema: ExtensionSchemaRecord | null,
  table: string
): Map<
  string,
  { kind: string; columns: readonly string[]; owner: ElementOnTable["owner"] }
> {
  const users = new Map<
    string,
    { kind: string; columns: readonly string[]; owner: ElementOnTable["owner"] }
  >();
  if (schema === null) return users;
  const tableOwner = schema.owners.get(table) ?? { kind: "app" as const };
  const contributorOf = (kind: string, name: string) =>
    schema.elementOwners
      .get(table)
      ?.find(
        element => element.elementKind === kind && element.elementName === name
      )?.owner;
  for (const index of schema.entityIndexes.get(table) ?? []) {
    if (index.name === undefined) continue;
    users.set(index.name, {
      kind: "index",
      columns: index.columns,
      owner: index.contributedBy ?? tableOwner,
    });
  }
  const spec = schema.specs.find(candidate => candidate.name === table);
  for (const index of spec?.indexes ?? []) {
    users.set(index.name, {
      kind: "index",
      columns: index.columns,
      owner: contributorOf("index", index.name) ?? tableOwner,
    });
  }
  for (const key of spec?.foreignKeys ?? []) {
    users.set(key.name, {
      kind: "fk",
      columns: key.columns,
      owner: contributorOf("fk", key.name) ?? tableOwner,
    });
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
  for (const dependents of onTables.values()) {
    for (const field of dependents.fields) {
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
  for (const [name, user] of compiled) {
    if (isThePlugin(user.owner, pluginName)) continue;
    if (!user.columns.includes(columnName)) continue;
    found.add({
      kind: kindName(user.kind),
      name,
      table,
      owner: `${describeOwner(user.owner)}, using column "${columnName}"`,
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
      !compiled.has(element.name)
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
