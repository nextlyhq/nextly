/**
 * Which live UNIQUE constraints a save keeps, and where to find them.
 *
 * A Schema Builder table gets an inline UNIQUE from its own DDL, on a
 * one-to-one relationship's column or a field marked unique, and nothing in
 * the desired snapshot describes it. drizzle-kit, handed runtime tables that
 * do not declare it, rebuilds a SQLite table without it and drops it on
 * PostgreSQL and MySQL, after which the column takes duplicates. A save keeps
 * the constraint while a desired field still makes its column unique
 * (`builderColumnIsUnique`, the rule the Builder's DDL applies), and lets it
 * go once none does, so a one-to-one changed to a many-to-one reaches the
 * database.
 *
 * The live tables are read before this apply's renames run, so a renamed
 * table or column is found under its live name and reported under the name
 * the desired schema gives it.
 *
 * @module domains/schema/pipeline/live-uniques
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { builderColumnIsUnique } from "../../dynamic-collections/services/dynamic-collection-schema-service";
import { toSnakeCase } from "../services/field-column-descriptor";

import type { NextlySchemaSnapshot, Operation } from "./diff/types";
import type { DesiredSchema } from "./types";

/** The renames an apply carries out, between live and desired names. */
export interface ApplyRenames {
  /** Desired table name, lower-cased → the name it has live. */
  liveTable: ReadonlyMap<string, string>;
  /** Live table name, lower-cased → the name the desired schema gives it. */
  desiredTable: ReadonlyMap<string, string>;
  /** Desired table, lower-cased → live column, lower-cased → desired column. */
  desiredColumn: ReadonlyMap<string, ReadonlyMap<string, string>>;
}

/** The table and column renames among an apply's operations. */
export function renamesOf(ops: readonly Operation[]): ApplyRenames {
  const liveTable = new Map<string, string>();
  const desiredTable = new Map<string, string>();
  const desiredColumn = new Map<string, Map<string, string>>();
  for (const op of ops) {
    if (op.type === "rename_table") {
      liveTable.set(op.toName.toLowerCase(), op.fromName);
      desiredTable.set(op.fromName.toLowerCase(), op.toName);
    } else if (op.type === "rename_column") {
      const table = op.tableName.toLowerCase();
      const columns = desiredColumn.get(table) ?? new Map<string, string>();
      columns.set(op.fromColumn.toLowerCase(), op.toColumn.toLowerCase());
      desiredColumn.set(table, columns);
    }
  }
  return { liveTable, desiredTable, desiredColumn };
}

/** The name a table the desired schema names has in the database now. */
export function liveTableName(table: string, renames: ApplyRenames): string {
  return renames.liveTable.get(table.toLowerCase()) ?? table;
}

/**
 * Desired table, lower-cased → the columns, lower-cased, a field of its
 * collection or Single makes unique.
 */
export function desiredUniqueColumns(
  desired: DesiredSchema
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const entity of [
    ...Object.values(desired.collections),
    ...Object.values(desired.singles),
  ]) {
    const columns = new Set(
      (entity.fields as unknown as FieldDefinition[])
        .filter(field => typeof field.name === "string")
        .filter(builderColumnIsUnique)
        .map(field => toSnakeCase(field.name).toLowerCase())
    );
    if (columns.size > 0) out.set(entity.tableName.toLowerCase(), columns);
  }
  return out;
}

/** A live column's name in the desired table, after this apply's renames. */
function desiredColumnName(
  desiredTable: string,
  liveColumn: string,
  renames: ApplyRenames
): string {
  const lower = liveColumn.toLowerCase();
  return (
    renames.desiredColumn.get(desiredTable.toLowerCase())?.get(lower) ?? lower
  );
}

/**
 * The column, in the desired spelling, of each single-column UNIQUE the live
 * table holds that a desired field still makes unique: what a SQLite runtime
 * table declares (`uniqueColumns`), so a rebuild keeps it. One spanning
 * several columns is left alone; nothing Nextly creates has one.
 */
export function uniqueColumnsToKeep(
  desiredTable: string,
  liveUniques: readonly (readonly string[])[],
  renames: ApplyRenames,
  desiredUnique: ReadonlyMap<string, ReadonlySet<string>>
): string[] {
  const wanted = desiredUnique.get(desiredTable.toLowerCase());
  if (wanted === undefined) return [];
  return liveUniques.flatMap(columns => {
    if (columns.length !== 1) return [];
    const column = desiredColumnName(desiredTable, columns[0], renames);
    return wanted.has(column) ? [column] : [];
  });
}

/**
 * The live unique constraints drizzle-kit must not drop, as `table.name`
 * keys, lower-cased, with the table under its desired name: each single-column
 * one whose column a desired field still makes unique, less any this apply's
 * own `drop_index` removes. On PostgreSQL the live snapshot lists the index
 * backing the constraint under the constraint's name; on MySQL the index is
 * the constraint.
 */
export function liveUniqueConstraintsToKeep(
  live: NextlySchemaSnapshot,
  ops: readonly Operation[],
  renames: ApplyRenames,
  desiredUnique: ReadonlyMap<string, ReadonlySet<string>>
): Set<string> {
  const dropped = new Set(
    ops.flatMap(op =>
      op.type === "drop_index"
        ? [`${op.tableName.toLowerCase()}.${op.index.name.toLowerCase()}`]
        : []
    )
  );
  const keep = new Set<string>();
  for (const table of live.tables) {
    const desiredTable =
      renames.desiredTable.get(table.name.toLowerCase()) ?? table.name;
    for (const index of table.indexes ?? []) {
      if (!index.unique) continue;
      const [column] = uniqueColumnsToKeep(
        desiredTable,
        [index.columns],
        renames,
        desiredUnique
      );
      if (column === undefined) continue;
      const key = `${desiredTable.toLowerCase()}.${index.name.toLowerCase()}`;
      if (!dropped.has(key)) keep.add(key);
    }
  }
  return keep;
}

/**
 * The planned operations less each add of a single-column unique index whose column the live
 * table already keeps unique.
 *
 * On SQLite an inline `UNIQUE` (a one-to-one's from the Builder's own DDL, or a unique field's
 * from a release that kept uniqueness inline) is backed by an internal `sqlite_autoindex_*` that
 * the live snapshot leaves out, so the diff reads the column as not unique and plans a second,
 * redundant unique index on a column that already refuses repeats: an operation on upgrade for a
 * schema nobody changed. PostgreSQL and MySQL list the index behind the constraint, which the diff
 * already matches by columns and uniqueness, so only SQLite is asked.
 *
 * @param ops the operations the diff planned
 * @param args.live the live snapshot the diff read: a table it does not hold has nothing yet
 */
export async function withoutUniquesAlreadyEnforced(
  ops: readonly Operation[],
  args: { db: unknown; dialect: SupportedDialect; live: NextlySchemaSnapshot }
): Promise<Operation[]> {
  if (args.dialect !== "sqlite") return [...ops];
  const liveTables = new Set(
    args.live.tables.map(table => table.name.toLowerCase())
  );
  // A unique index over one column, on a table the database already has.
  const addsUniqueOnLiveTable = (
    op: Operation
  ): op is Extract<Operation, { type: "add_index" }> =>
    op.type === "add_index" &&
    op.index.unique &&
    op.index.columns.length === 1 &&
    liveTables.has(op.tableName.toLowerCase());
  const candidates = ops.filter(addsUniqueOnLiveTable);
  if (candidates.length === 0) return [...ops];
  // Loaded when there is something to ask: the catalog readers carry every dialect's queries.
  const { readUniqueColumns } = await import("./live-table-facts");
  const enforced = new Map<string, ReadonlyMap<string, string | null>>();
  for (const op of candidates) {
    const table = op.tableName.toLowerCase();
    if (!enforced.has(table)) {
      enforced.set(
        table,
        await readUniqueColumns(args.db, args.dialect, op.tableName)
      );
    }
  }
  return ops.filter(
    op =>
      !(
        addsUniqueOnLiveTable(op) &&
        enforced.get(op.tableName.toLowerCase())?.has(op.index.columns[0])
      )
  );
}
