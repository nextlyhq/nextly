/**
 * The facts a migration's deletions are judged against without a database
 * (`fileDeletions`): what `migrate:check` reads a file against, and what
 * `migrate:create` reads the files it is about to write against, so both
 * name the deletions `nextly migrate` will ask consent for.
 *
 * No foreign key or trigger is known: the deletions named are the ones the
 * statements name, and the run itself judges what a removal reaches. The
 * user-defined functions are `functions`, the ones a migration file defines.
 * The columns of the tables a SQLite rebuild rebuilds are read from `schema`,
 * the snapshot of the schema the statements run against, so a column the
 * rebuild leaves out is named. Without a snapshot, or for a table it does not
 * hold, a rebuild is left to the run unless it carries everything.
 *
 * @module domains/schema/migrate/offline-deletion-facts
 */
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";
import { renderedType } from "../pipeline/sql-templates/create-table-body";

import type { DeletionFacts } from "./file-deletions";

export function offlineDeletionFacts(
  schema: NextlySchemaSnapshot | undefined,
  functions: ReadonlySet<string>
): DeletionFacts {
  const columnTypes = new Map(
    (schema?.tables ?? []).map(table => [
      table.name.toLowerCase(),
      // Each type as the generated DDL spells it, so a column the rebuild
      // carries unchanged compares equal and only a converted one is named.
      new Map(
        table.columns.map(column => [
          column.name.toLowerCase(),
          renderedType(column).toLowerCase(),
        ])
      ),
    ])
  );
  return {
    cascadeFrom: () => [],
    truncateCascadeFrom: () => [],
    nulledBy: () => [],
    // No code a table carries, nor inheritance tree, is known without a
    // database; the run judges what a change reaches.
    hiddenCode: () => false,
    descendantsOf: () => [],
    // The tables the schema before the statements holds, from its snapshot.
    liveTable: table =>
      schema === undefined ? undefined : columnTypes.has(table.toLowerCase()),
    userFunctions: functions,
    unseenRebuild: "deferred",
    // Derived from the one reading of the types, so the two agree on which
    // columns a table has.
    liveColumns: new Map(
      [...columnTypes].map(([table, columns]) => [
        table,
        new Set(columns.keys()),
      ])
    ),
    liveColumnTypes: columnTypes,
  };
}
