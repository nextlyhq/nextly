/**
 * What a planned migration deletes, read from its operations.
 *
 * One list, derived once from the plan the file is rendered from: the file's
 * header names it (`formatMigrationFile`), and `migrate:create` lists it,
 * counts it where the database can be read, and asks the data-loss consent
 * for it before the file is written.
 *
 * - A table dropped: a table deletion. In a generated migration every dropped
 *   table is one the config no longer declares: a removed collection, Single
 *   or field group, its junction tables, or an extension table.
 * - A column dropped: a column deletion, named as a declined rename where the
 *   person (or a run that cannot ask) declined renaming it.
 * - A type change that clears the values the new type cannot hold
 *   (`clearsValues`): a deletion in its column (`clearsSome`).
 * - Rows a person's answer removes so a column can be required: a deletion of
 *   rows in its table.
 *
 * Judged from the operations rather than the SQL, so a SQLite rebuild is the
 * column it drops or the values it clears, never a dropped table. A rename,
 * an index, a key, a check or a type change that keeps every value deletes
 * nothing.
 *
 * @module domains/schema/migrate-create/planned-deletions
 */
import type { Deletion } from "../migrate/data-loss-consent";
import type { Operation } from "../pipeline/diff/types";
import type { ColumnResolution } from "../pipeline/sql-templates/resolution-statements";

/** A rename the person (or a run that cannot ask) declined: its pair stays a drop and an add. */
export interface DeclinedRename {
  tableName: string;
  fromColumn: string;
  toColumn: string;
}

const NOT_IN_CONFIG = "no longer in the config";

/**
 * Every deletion the plan makes: tables first, then columns, then rows, each
 * in name order, so the header of a file and its listing read the same on
 * every run of the same plan.
 */
export function plannedDeletions(args: {
  operations: readonly Operation[];
  declinedRenames?: readonly DeclinedRename[];
  resolutions?: readonly ColumnResolution[];
}): Deletion[] {
  const declinedTo = new Map<string, string[]>();
  for (const rename of args.declinedRenames ?? []) {
    const key = `${rename.tableName}.${rename.fromColumn}`;
    declinedTo.set(key, [...(declinedTo.get(key) ?? []), rename.toColumn]);
  }

  const tables: Deletion[] = [];
  const columns: Deletion[] = [];
  for (const op of args.operations) {
    if (op.type === "drop_table") {
      tables.push({
        kind: "table",
        table: op.tableName,
        reason: NOT_IN_CONFIG,
      });
    } else if (op.type === "drop_column") {
      const targets = declinedTo.get(`${op.tableName}.${op.columnName}`);
      columns.push({
        kind: "column",
        table: op.tableName,
        column: op.columnName,
        reason:
          targets === undefined
            ? NOT_IN_CONFIG
            : `rename to ${targets.join(" or ")} declined`,
      });
    } else if (op.type === "change_column_type" && op.clearsValues === true) {
      columns.push({
        kind: "column",
        table: op.tableName,
        column: op.columnName,
        clearsSome: true,
        reason: `${op.fromType} to ${op.toType} clears the values ${op.toType} cannot hold`,
      });
    }
  }
  const rows: Deletion[] = (args.resolutions ?? []).flatMap(resolution =>
    resolution.kind === "delete_nonconforming"
      ? [
          {
            kind: "rows" as const,
            table: resolution.tableName,
            reason: `rows with no ${resolution.columnName} removed, so the column can be required`,
          },
        ]
      : []
  );
  return [...byName(tables), ...byName(columns), ...byName(rows)];
}

/** `deletions` in name order: by table, then column. */
function byName(deletions: Deletion[]): Deletion[] {
  const name = (d: Deletion) =>
    d.kind === "column"
      ? `${d.table}\u0000${d.column}`
      : d.kind === "unnamed"
        ? d.description
        : d.table;
  return [...deletions].sort((a, b) =>
    name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0
  );
}
