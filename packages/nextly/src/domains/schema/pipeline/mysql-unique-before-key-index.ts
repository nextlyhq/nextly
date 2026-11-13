/**
 * MySQL refuses to drop the last index a foreign key can use. A push that replaces a column's
 * plain index with a unique one led by the same column (a relationship marked Unique, or made
 * one-to-one) drops the plain index ahead of the unique one's create when drizzle-kit emits the
 * drop and the create is restored after it, so on a column a key uses the drop is refused. The
 * create is moved ahead of that drop, where the key can use the unique index once the plain one
 * goes. Every other statement keeps its place, and nothing moves on PostgreSQL or SQLite.
 *
 * The diff's own drop of such an index runs in the pre-resolution pass, ahead of every create, so
 * it is held out of that pass (`keyIndexDropsHeldForUnique`) and added to the apply's batch
 * instead (`withHeldKeyIndexDrops`), where the create runs first.
 *
 * @module domains/schema/pipeline/mysql-unique-before-key-index
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { DropIndexOp, Operation, TableSpec } from "./diff/types";

/** `DROP INDEX \`i\` ON \`t\``, or `ALTER TABLE \`t\` DROP INDEX \`i\``: the index and its table. */
function droppedIndex(
  statement: string
): { index: string; table: string } | undefined {
  const drop = /^\s*DROP\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*;?\s*$/i.exec(
    statement
  );
  if (drop) return { index: drop[1], table: drop[2] };
  const alter =
    /^\s*ALTER\s+TABLE\s+`([^`]+)`\s+DROP\s+INDEX\s+`([^`]+)`\s*;?\s*$/i.exec(
      statement
    );
  return alter ? { index: alter[2], table: alter[1] } : undefined;
}

/** `CREATE UNIQUE INDEX \`u\` ON \`t\` (\`c\`, ...)`: its name, table and leading column. */
function createdUnique(
  statement: string
): { index: string; table: string; column: string } | undefined {
  const create =
    /^\s*CREATE\s+UNIQUE\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\(\s*`([^`]+)`/i.exec(
      statement
    );
  return create
    ? { index: create[1], table: create[2], column: create[3] }
    : undefined;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * `statements` with each unique index create moved ahead of the drop of the plain index on the
 * same leading column, where a foreign key of the live table uses that column. MySQL only.
 *
 * @param live the tables as the database holds them before the push, with their indexes and keys
 */
export function uniqueCreatedBeforeKeyIndexDrop(
  statements: readonly string[],
  dialect: SupportedDialect,
  live: readonly Pick<TableSpec, "name" | "indexes" | "foreignKeys">[]
): string[] {
  if (dialect !== "mysql") return [...statements];
  const ordered = [...statements];
  for (let at = 0; at < ordered.length; at++) {
    const drop = droppedIndex(ordered[at]);
    if (!drop) continue;
    const column = keyIndex(live, drop.table, drop.index);
    if (column === undefined) continue;
    const later = ordered.findIndex((statement, i) => {
      if (i <= at) return false;
      const create = createdUnique(statement);
      // A unique index under the plain one's own name cannot be made before it goes.
      return (
        create !== undefined &&
        same(create.table, drop.table) &&
        same(create.column, column) &&
        !same(create.index, drop.index)
      );
    });
    if (later === -1) continue;
    const [create] = ordered.splice(later, 1);
    ordered.splice(at, 0, create);
    at += 1;
  }
  return ordered;
}

/** The live table `name`'s plain index `index`, led by a column one of its foreign keys uses. */
function keyIndex(
  live: readonly Pick<TableSpec, "name" | "indexes" | "foreignKeys">[],
  name: string,
  index: string
): string | undefined {
  const table = live.find(t => same(t.name, name));
  const held = table?.indexes?.find(i => same(i.name, index));
  const column = held?.columns[0];
  if (!table || !held || held.unique || column === undefined) return undefined;
  return (table.foreignKeys ?? []).some(
    key => key.columns[0] !== undefined && same(key.columns[0], column)
  )
    ? column
    : undefined;
}

/**
 * The index drops among `ops` that wait for the unique index replacing them: on MySQL, a plain
 * index led by a column a foreign key of the live table uses, where `ops` also adds a unique index
 * led by that column on the same table, under another name: one under the plain index's own
 * name cannot be made before that index goes, so its drop is left where it was.
 */
export function keyIndexDropsHeldForUnique(
  ops: readonly Operation[],
  dialect: SupportedDialect,
  live: readonly Pick<TableSpec, "name" | "indexes" | "foreignKeys">[]
): DropIndexOp[] {
  if (dialect !== "mysql") return [];
  return ops.filter((op): op is DropIndexOp => {
    if (op.type !== "drop_index") return false;
    const column = keyIndex(live, op.tableName, op.index.name);
    return (
      column !== undefined &&
      ops.some(
        add =>
          add.type === "add_index" &&
          add.index.unique &&
          !same(add.index.name, op.index.name) &&
          same(add.tableName, op.tableName) &&
          add.index.columns[0] !== undefined &&
          same(add.index.columns[0], column)
      )
    );
  });
}

/** `statements` with each held drop added at the end, unless one of them already drops it. */
export function withHeldKeyIndexDrops(
  statements: readonly string[],
  held: readonly DropIndexOp[]
): string[] {
  const out = [...statements];
  for (const op of held) {
    const dropped = out.some(statement => {
      const drop = droppedIndex(statement);
      return (
        drop !== undefined &&
        same(drop.index, op.index.name) &&
        same(drop.table, op.tableName)
      );
    });
    if (!dropped) {
      out.push(`DROP INDEX \`${op.index.name}\` ON \`${op.tableName}\``);
    }
  }
  return out;
}
