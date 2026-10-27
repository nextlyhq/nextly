/**
 * What other owners have built on a set of tables that a delete would drop.
 *
 * Dropping a collection's, Single's or field group's tables takes with them
 * everything another owner put there, and on PostgreSQL a `CASCADE` silently
 * strips every foreign key that points at them from another owner's table.
 * The drop guard cannot see either: it reads statement text, and a
 * `DROP TABLE` names only the table being dropped. So a delete asks here,
 * before its first statement, what it would take from somebody else:
 *
 * - **Foreign keys pointing at the tables**, declared by a plugin or the app on
 *   a table of its own (or contributed to one), read from the compiled
 *   extension schema.
 * - **Elements on the tables**: a hidden column, an index, a foreign key or a
 *   check another owner added to them. Read from the compiled extension
 *   schema, which records each with its contributor, and from the element
 *   rows `nextly_schema_owners` holds, which outlive the configuration that
 *   declared them.
 *
 * Reading is the caller's to make fail closed: every function here either
 * answers or throws, and none turns a failure to read into "nothing".
 *
 * @module domains/schema/ownership/dependent-elements
 */
import type { ExtensionSchema } from "../extension/build-extension-schema";
import type { SchemaOwner } from "../extension/types";

import { ownerRecordKey, type OwnerRecord } from "./owner-registry";
import {
  SchemaOwnersRepository,
  schemaOwnersTableExists,
} from "./schema-owners-repository";

/** The parts of a compiled extension schema these questions read. */
export type ExtensionSchemaRecord = Pick<
  ExtensionSchema,
  "specs" | "owners" | "entityColumns" | "entityIndexes" | "elementOwners"
>;

/** The kinds of element another owner can add to a table. */
export type DependentElementKind = "column" | "index" | "fk" | "check";

/** A foreign key on another owner's table that points at one of the tables. */
export interface ForeignKeyInto {
  /** Who declared the key: its table's owner, or whoever contributed the key. */
  owner: SchemaOwner;
  /** The table the key is on. */
  table: string;
  /** The key's constraint name. */
  name: string;
  /** The table it points at. */
  referencesTable: string;
}

/** A column, index, foreign key or check another owner added to one of the tables. */
export interface ElementOnTable {
  owner: SchemaOwner;
  kind: DependentElementKind;
  name: string;
  table: string;
}

/** Who owns what nothing names an owner for: the app, whose stream carries it. */
const APP: SchemaOwner = { kind: "app" };

/**
 * Every declared foreign key that points at one of `tables` from a table
 * outside them.
 *
 * A key on one of the tables themselves goes with them, so it is not counted.
 * The owner is the key's contributor when the key was added to somebody
 * else's table, and the table's owner otherwise.
 */
export function foreignKeysInto(
  schema: ExtensionSchemaRecord,
  tables: ReadonlySet<string>
): ForeignKeyInto[] {
  const keys: ForeignKeyInto[] = [];
  for (const spec of schema.specs) {
    if (tables.has(spec.name)) continue;
    for (const key of spec.foreignKeys ?? []) {
      if (!tables.has(key.referencesTable)) continue;
      const contributor = schema.elementOwners
        .get(spec.name)
        ?.find(
          element =>
            element.elementKind === "fk" && element.elementName === key.name
        )?.owner;
      keys.push({
        owner: contributor ?? schema.owners.get(spec.name) ?? APP,
        table: spec.name,
        name: key.name,
        referencesTable: key.referencesTable,
      });
    }
  }
  return keys;
}

/**
 * Every column, index, foreign key and check the compiled schema records
 * another owner as having added to one of `tables`.
 *
 * An entity's table carries its contributions as hidden columns and indexes,
 * each with its contributor; a plugin's or the app's table carries them as
 * element owners. Both are read, so the answer does not depend on which kind
 * of table was asked about.
 */
export async function elementsAddedTo(
  schema: ExtensionSchemaRecord,
  tables: Iterable<string>
): Promise<ElementOnTable[]> {
  // Imported when asked: the index naming rule lives beside the compiler,
  // which a service deleting an entity has no other reason to load.
  const { resolveIndexName } = await import("../extension/compile");
  const elements: ElementOnTable[] = [];
  for (const table of tables) {
    for (const column of schema.entityColumns.get(table) ?? []) {
      elements.push({
        owner: column.contributedBy ?? APP,
        kind: "column",
        name: column.name,
        table,
      });
    }
    for (const index of schema.entityIndexes.get(table) ?? []) {
      elements.push({
        owner: index.contributedBy ?? APP,
        kind: "index",
        name: resolveIndexName(table, index),
        table,
      });
    }
    for (const element of schema.elementOwners.get(table) ?? []) {
      elements.push({
        owner: element.owner,
        kind: element.elementKind,
        name: element.elementName,
        table,
      });
    }
  }
  return distinctElements(elements);
}

/** The owner an element row names, in the form the compiled schema uses. */
function ownerOfRow(row: OwnerRecord): SchemaOwner {
  return row.ownerKind === "app" ? APP : { kind: "plugin", id: row.ownerId };
}

/** The element rows among `rows`, as elements; table-level rows are not elements. */
export function elementsFromOwnerRows(
  rows: readonly OwnerRecord[]
): ElementOnTable[] {
  const elements: ElementOnTable[] = [];
  for (const row of rows) {
    const kind = row.elementKind ?? "table";
    if (kind === "table") continue;
    elements.push({
      owner: ownerOfRow(row),
      kind,
      name: row.elementName ?? "",
      table: row.tableName,
    });
  }
  return elements;
}

/** What reading the recorded element rows needs from an adapter. */
export interface RecordedElementsAdapter {
  dialect: OwnerRecordDialect;
  getDrizzle<T = unknown>(): T;
  listTables(): Promise<string[]>;
}

type OwnerRecordDialect = ConstructorParameters<
  typeof SchemaOwnersRepository
>[1];

/**
 * The element rows `nextly_schema_owners` holds for `tables`.
 *
 * A database whose registry has not been created yet (one `nextly migrate`
 * has not run on) has recorded nothing, so that alone is an empty answer. Any
 * other failure to read it is thrown: the caller must not take it for none.
 */
export async function readRecordedElementsOn(
  adapter: RecordedElementsAdapter,
  tables: readonly string[]
): Promise<ElementOnTable[]> {
  if (tables.length === 0) return [];
  if (!(await schemaOwnersTableExists(adapter))) return [];
  const rows = await new SchemaOwnersRepository(
    adapter.getDrizzle(),
    adapter.dialect
  ).read(tables);
  return elementsFromOwnerRows(rows);
}

/**
 * The elements once each, keyed as owner rows are: by table, kind and name.
 * The compiled schema and the recorded rows describe the same element when
 * both hold it, and listing it twice would read as two.
 */
export function distinctElements(
  elements: readonly ElementOnTable[]
): ElementOnTable[] {
  const seen = new Map<string, ElementOnTable>();
  for (const element of elements) {
    const key = ownerRecordKey({
      tableName: element.table,
      elementKind: element.kind,
      elementName: element.name,
    });
    if (!seen.has(key)) seen.set(key, element);
  }
  return [...seen.values()];
}

/** How an owner reads in a message a person acts on. */
export function describeOwner(owner: SchemaOwner): string {
  return owner.kind === "plugin" ? `plugin "${owner.id}"` : "the app";
}
