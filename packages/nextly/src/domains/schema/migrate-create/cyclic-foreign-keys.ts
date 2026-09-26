/**
 * The foreign keys of a cycle, split out of the table operations that would
 * need them before the other table of the cycle exists.
 *
 * `diffSnapshots` creates new tables after the tables they reference, and
 * drops tables before the tables they referenced, so a table operation only
 * ever meets a key to a table that exists — except in a cycle, where one
 * table of the cycle must come first either way. PostgreSQL and MySQL refuse
 * a key to a table that does not exist yet, and MySQL refuses to drop a table
 * another still references. SQLite accepts both, and takes a key nowhere but
 * inside `CREATE TABLE`, so it keeps every key inline and is left alone.
 *
 * On PostgreSQL and MySQL, then:
 * - a new table's key to a table created later in the list is taken out of
 *   its `CREATE TABLE` and added once every table of the list exists;
 * - a dropped table's key to a table dropped earlier in the list is dropped
 *   before any table is.
 *
 * It is applied to a migration's operations AND to their inverse, the down
 * migration, which re-creates dropped tables from their full specs and drops
 * created ones: a cycle broken on the way up is broken again on the way down.
 * A key the list already adds or drops on its own is not added twice.
 *
 * Dev push does not need this: its emitter adds every new table's keys after
 * all of that apply's tables exist, and PostgreSQL drops with CASCADE.
 *
 * @module domains/schema/migrate-create/cyclic-foreign-keys
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type {
  AddForeignKeyOp,
  AddTableOp,
  DropForeignKeyOp,
  Operation,
  TableSpec,
} from "../pipeline/diff/types";

export function withCyclicForeignKeysSplit(
  ops: Operation[],
  dialect: SupportedDialect,
  /** The tables as they stand before `ops` — where a dropped table's keys are read. */
  tablesBefore: readonly TableSpec[]
): Operation[] {
  if (dialect === "sqlite") return ops;
  return deferForwardKeys(releaseBackwardKeys(ops, tablesBefore));
}

/** A key's identity within one list of operations. */
const keyId = (tableName: string, name: string): string =>
  `${tableName}\u0000${name}`;

/** New tables' keys to tables created later, added after every table. */
function deferForwardKeys(ops: Operation[]): Operation[] {
  const createdHere = new Set(
    ops.flatMap(op => (op.type === "add_table" ? [op.table.name] : []))
  );
  const addedAlready = new Set(
    ops.flatMap(op =>
      op.type === "add_foreign_key"
        ? [keyId(op.tableName, op.foreignKey.name)]
        : []
    )
  );
  const created = new Set<string>();
  const deferred: AddForeignKeyOp[] = [];
  const planned = ops.map(op => {
    if (op.type !== "add_table") return op;
    created.add(op.table.name);
    const forward = (op.table.foreignKeys ?? []).filter(
      fk =>
        createdHere.has(fk.referencesTable) && !created.has(fk.referencesTable)
    );
    if (forward.length === 0) return op;
    for (const foreignKey of forward) {
      if (addedAlready.has(keyId(op.table.name, foreignKey.name))) continue;
      deferred.push({
        type: "add_foreign_key",
        tableName: op.table.name,
        foreignKey,
      });
    }
    return {
      ...op,
      table: {
        ...op.table,
        foreignKeys: (op.table.foreignKeys ?? []).filter(
          fk => !forward.includes(fk)
        ),
      },
    } satisfies AddTableOp;
  });
  if (deferred.length === 0 && planned.every((op, i) => op === ops[i])) {
    return ops;
  }
  const afterLastCreate =
    planned.map(op => op.type).lastIndexOf("add_table") + 1;
  return [
    ...planned.slice(0, afterLastCreate),
    ...deferred,
    ...planned.slice(afterLastCreate),
  ];
}

/** Dropped tables' keys to tables dropped earlier, dropped before any table. */
function releaseBackwardKeys(
  ops: Operation[],
  tablesBefore: readonly TableSpec[]
): Operation[] {
  const dropOrder = ops.flatMap(op =>
    op.type === "drop_table" ? [op.tableName] : []
  );
  if (dropOrder.length < 2) return ops;
  const specByName = new Map(tablesBefore.map(table => [table.name, table]));
  const droppedAlready = new Set(
    ops.flatMap(op =>
      op.type === "drop_foreign_key"
        ? [keyId(op.tableName, op.foreignKey.name)]
        : []
    )
  );
  const released: DropForeignKeyOp[] = [];
  dropOrder.forEach((tableName, position) => {
    const droppedEarlier = new Set(dropOrder.slice(0, position));
    for (const foreignKey of specByName.get(tableName)?.foreignKeys ?? []) {
      if (!droppedEarlier.has(foreignKey.referencesTable)) continue;
      if (droppedAlready.has(keyId(tableName, foreignKey.name))) continue;
      released.push({ type: "drop_foreign_key", tableName, foreignKey });
    }
  });
  if (released.length === 0) return ops;
  const firstDrop = ops.findIndex(op => op.type === "drop_table");
  return [...ops.slice(0, firstDrop), ...released, ...ops.slice(firstDrop)];
}
