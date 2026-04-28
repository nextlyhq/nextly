// F4 Option E RegexRenameDetector.
//
// Reads Operation[] (from our diff engine) and emits one RenameCandidate
// per (DROP, ADD) Cartesian pair grouped by table. Type-family compatibility
// is computed using the type strings already on the operations (drop_column
// carries fromType, add_column carries toType).
//
// Renamed from F4 PR 1's SQL-string-parsing approach. The Cartesian +
// type-family + sort logic is preserved exactly; only the input format
// changes from `string[]` to `Operation[]`.
//
// Wired into the pipeline by F4 Option E PR 3 (replaces the prior
// signature). The detector is pure: no I/O, no logging, no thrown errors.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { AddColumnOp, DropColumnOp, Operation } from "./diff/types.js";
import type {
  RenameCandidate,
  RenameDetector,
} from "./pushschema-pipeline-interfaces.js";
import { isTypesCompatible } from "./rename-detector-type-families.js";

export class RegexRenameDetector implements RenameDetector {
  detect(
    operations: Operation[],
    dialect: SupportedDialect
  ): RenameCandidate[] {
    // Group drop_column / add_column ops by table.
    const dropsByTable = new Map<string, DropColumnOp[]>();
    const addsByTable = new Map<string, AddColumnOp[]>();

    for (const op of operations) {
      if (op.type === "drop_column") {
        const list = dropsByTable.get(op.tableName) ?? [];
        list.push(op);
        dropsByTable.set(op.tableName, list);
      } else if (op.type === "add_column") {
        const list = addsByTable.get(op.tableName) ?? [];
        list.push(op);
        addsByTable.set(op.tableName, list);
      }
      // Other op types (rename_column, change_*, drop_table, add_table)
      // are not rename candidates - silently ignored.
    }

    // Per-table Cartesian pairing.
    const candidates: RenameCandidate[] = [];
    for (const [tableName, drops] of dropsByTable) {
      const adds = addsByTable.get(tableName);
      if (!adds || adds.length === 0) continue;
      for (const drop of drops) {
        for (const add of adds) {
          const fromType = drop.columnType;
          const toType = add.column.type;
          const compatible =
            fromType === ""
              ? false
              : isTypesCompatible(fromType, toType, dialect);
          candidates.push({
            tableName,
            fromColumn: drop.columnName,
            toColumn: add.column.name,
            fromType,
            toType,
            typesCompatible: compatible,
            defaultSuggestion: compatible ? "rename" : "drop_and_add",
          });
        }
      }
    }

    // Deterministic sort by (tableName, fromColumn, toColumn) for
    // test-stable ordering.
    candidates.sort((a, b) => {
      if (a.tableName !== b.tableName)
        return a.tableName < b.tableName ? -1 : 1;
      if (a.fromColumn !== b.fromColumn)
        return a.fromColumn < b.fromColumn ? -1 : 1;
      if (a.toColumn !== b.toColumn) return a.toColumn < b.toColumn ? -1 : 1;
      return 0;
    });

    return candidates;
  }
}
