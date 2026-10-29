/**
 * The foreign keys a Schema Builder collection's table carries in the
 * desired schema.
 *
 * The Builder creates a table with each relationship's key, but every later
 * save goes through the push pipeline, whose desired schema described no key
 * at all. So a relationship added to an existing table got none, on any
 * dialect, and the keys a table did have were invisible to the diff. On
 * SQLite that was worst: a key lives only in `CREATE TABLE`, the push
 * rebuilds a table to change a column's type, and the rebuild was made from
 * a definition without the key, so it was dropped, or the whole save was
 * refused because drizzle-kit, reading the whole database, saw a key nothing
 * declared.
 *
 * The table's keys here are the ones its live table already holds, kept
 * while their columns remain, and the key of each relationship whose column
 * this push adds, described by the Builder's own rule
 * (`relationshipForeignKey`). A relationship the change adds whose column an
 * earlier apply already added counts as added: MySQL commits each schema
 * statement, so an apply refused part-way can leave the column without its
 * key. Nothing else: a relationship the registry already records whose
 * column has no key keeps it that way, so an existing install is planned no
 * new key it did not ask for, and a code-first collection is not touched.
 * A relationship the save renames keeps what its old column had: the keys are
 * planned before the save's renames are known, so its new column reads as
 * added, and `withoutKeysOnKeylessRenames` takes back a key its old column
 * never had.
 *
 * @module domains/schema/pipeline/builder-foreign-keys
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { DynamicCollectionSchemaService } from "../../dynamic-collections/services/dynamic-collection-schema-service";

import type {
  ForeignKeySpec,
  NextlySchemaSnapshot,
  Operation,
  TableSpec,
} from "./diff/types";
import type { DesiredCollection } from "./types";

export function withBuilderForeignKeys(
  spec: TableSpec,
  collection: DesiredCollection,
  live: TableSpec | undefined,
  dialect: SupportedDialect
): TableSpec {
  if (collection.builderOwned !== true) return spec;

  const lower = (name: string) => name.toLowerCase();
  const columns = new Set(spec.columns.map(column => lower(column.name)));
  const liveColumns = new Set(
    (live?.columns ?? []).map(column => lower(column.name))
  );
  // Without the recorded field list, every column already in place counts as recorded.
  const recorded =
    collection.recordedFields === undefined
      ? undefined
      : new Set(collection.recordedFields);

  // Kept: every key the live table holds whose columns the table keeps. A key
  // over a column this push drops goes with the column.
  const kept = (live?.foreignKeys ?? []).filter(fk =>
    fk.columns.every(column => columns.has(lower(column)))
  );
  const keyed = new Set(kept.flatMap(fk => fk.columns.map(lower)));

  // Created: the key of each relationship whose column this push adds.
  const builder = new DynamicCollectionSchemaService(undefined, dialect);
  const created: ForeignKeySpec[] = [];
  for (const field of collection.fields as unknown as FieldDefinition[]) {
    // Read first without judging the actions: a relationship whose column
    // already exists keeps whatever it has, and a combination an older save
    // accepted (a required relationship that nulls on delete) must not block
    // every later save of the collection over a key nothing is creating.
    const described = builder.relationshipForeignKey(spec.name, field, false);
    if (described === null) continue;
    const column = lower(described.columns[0]);
    const addedByThisChange =
      !liveColumns.has(column) ||
      (recorded !== undefined && !recorded.has(field.name));
    if (!columns.has(column) || !addedByThisChange || keyed.has(column)) {
      continue;
    }
    // A key this push creates is judged: what a save asks for has to be
    // possible, exactly as when the Builder creates the table.
    const fk = builder.relationshipForeignKey(spec.name, field);
    if (fk !== null) created.push(fk);
  }

  return { ...spec, foreignKeys: [...kept, ...created] };
}

/**
 * The plan without a key on a Schema Builder relationship column that a
 * rename in this save gives a new name, when its old column had none.
 *
 * `withBuilderForeignKeys` plans keys as the desired snapshot is built, before
 * the save's renames are answered, so a renamed relationship reads as one the
 * change adds and its new column is keyed. Keying it is not the rename's to
 * do: rows that point at deleted entries would refuse the key, and its delete
 * action would start to fire. The key is taken back from both places it is
 * planned: the operations, from which keys are added by statement, and the
 * desired snapshot, from which a table SQLite rebuilds declares them. A
 * renamed column whose old one had a key keeps it, and a table the Builder
 * does not own keeps what its config declares.
 */
export function withoutKeysOnKeylessRenames(
  operations: Operation[],
  desired: NextlySchemaSnapshot,
  live: NextlySchemaSnapshot,
  builderTables: ReadonlySet<string>
): { operations: Operation[]; desired: NextlySchemaSnapshot } {
  const lower = (name: string) => name.toLowerCase();
  const keyedBefore = (table: string, column: string) =>
    (
      live.tables.find(t => lower(t.name) === lower(table))?.foreignKeys ?? []
    ).some(fk => fk.columns.some(c => lower(c) === lower(column)));
  const renamedKeyless = new Set(
    operations.flatMap(op =>
      op.type === "rename_column" &&
      builderTables.has(lower(op.tableName)) &&
      !keyedBefore(op.tableName, op.fromColumn)
        ? [`${lower(op.tableName)}.${lower(op.toColumn)}`]
        : []
    )
  );
  if (renamedKeyless.size === 0) return { operations, desired };
  const onRenamedKeyless = (table: string, fk: ForeignKeySpec) =>
    fk.columns.some(column =>
      renamedKeyless.has(`${lower(table)}.${lower(column)}`)
    );
  return {
    operations: operations.filter(
      op =>
        op.type !== "add_foreign_key" ||
        !onRenamedKeyless(op.tableName, op.foreignKey)
    ),
    desired: {
      ...desired,
      tables: desired.tables.map(table =>
        (table.foreignKeys ?? []).some(fk => onRenamedKeyless(table.name, fk))
          ? {
              ...table,
              foreignKeys: (table.foreignKeys ?? []).filter(
                fk => !onRenamedKeyless(table.name, fk)
              ),
            }
          : table
      ),
    },
  };
}
