/**
 * Element owner rows whose element no longer exists anywhere.
 *
 * A row names who owns a column, index, foreign key or check that a
 * contributor added to a table another owner declared. Rows were only ever
 * written, so one outlived its element: when the owner or another contributor
 * later reused the name, the stale row attributed the new element to the old
 * stream, and that stream's reconcile stripped a live element it did not own
 * — failing the next valid migration as drift.
 *
 * A row is retired only when its element is gone from BOTH the config and the
 * database. Declared-but-absent is a migration still to run; present-but-
 * undeclared is a drop still to run — in either case the row is still true.
 *
 * @module domains/schema/ownership/retired-elements
 */
import type { NextlySchemaSnapshot, TableSpec } from "../pipeline/diff/types";

import type { OwnerRecord } from "./owner-registry";

type ElementKind = "column" | "index" | "fk" | "check";

/** One element, as the compiled schema declares it. */
export interface DeclaredElement {
  elementKind: ElementKind;
  elementName: string;
}

/** An element row, which is what retirement ever returns. */
export type RetiredElementRow = OwnerRecord & { elementKind: ElementKind };

/** Where each element kind lives on a table spec. */
const LIVE_DIMENSION: Record<ElementKind, keyof TableSpec> = {
  column: "columns",
  index: "indexes",
  fk: "foreignKeys",
  check: "checks",
};

/**
 * The element rows to delete.
 *
 * `live` should hold every table a candidate row names; a table missing from
 * it counts as gone, since introspection reports every table that exists. A
 * dimension the live side did not track (`undefined`) proves nothing, so a row
 * for it is kept.
 */
export function retiredElementRows(input: {
  rows: readonly OwnerRecord[];
  declared: ReadonlyMap<string, readonly DeclaredElement[]>;
  live: NextlySchemaSnapshot;
}): RetiredElementRow[] {
  const declaredKeys = new Set<string>();
  for (const [table, elements] of input.declared) {
    for (const element of elements) {
      declaredKeys.add(keyOf(table, element.elementKind, element.elementName));
    }
  }
  const liveByName = new Map(
    input.live.tables.map(table => [table.name, table])
  );

  return input.rows.filter((row): row is RetiredElementRow => {
    const kind = row.elementKind ?? "table";
    if (kind === "table") return false;
    const name = row.elementName ?? "";
    if (declaredKeys.has(keyOf(row.tableName, kind, name))) return false;
    const liveTable = liveByName.get(row.tableName);
    if (liveTable === undefined) return true;
    const present = liveTable[LIVE_DIMENSION[kind]] as
      | readonly { name: string }[]
      | undefined;
    if (present === undefined) return false;
    return !present.some(element => element.name === name);
  });
}

function keyOf(table: string, kind: string, name: string): string {
  return `${table}\u0000${kind}\u0000${name}`;
}
