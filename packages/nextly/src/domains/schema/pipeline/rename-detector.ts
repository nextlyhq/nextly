// F4 RenameDetector - public facade.
//
// Reads drizzle-kit's statementsToExecute and emits one RenameCandidate
// per (DROP, ADD) Cartesian pair grouped by table. Type-family compatibility
// is computed using the live-introspected fromType supplied by the pipeline
// (see live-column-types.ts) and the toType captured from the ADD statement.
//
// Design decisions are captured in plans/specs/F4-rename-detector-design.md
// (sections 3.1-3.5 and section 6 Decisions log).
//
// This class is wired into the pipeline by F4 PR-2 (replaces noopRenameDetector
// in pipeline/index.ts and init/reload-config.ts). PR-1 ships it additively
// without touching any production wiring.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type {
  RenameCandidate,
  RenameDetector,
} from "./pushschema-pipeline-interfaces.js";
import {
  parseAddColumn,
  parseDropColumn,
  splitMysqlCombinedStatement,
  type ParsedAddColumn,
  type ParsedDropColumn,
} from "./rename-detector-parsing.js";
import { filterSqliteRecreateBlocks } from "./rename-detector-sqlite-recreate.js";
import { isTypesCompatible } from "./rename-detector-type-families.js";

export class RegexRenameDetector implements RenameDetector {
  detect(
    statements: string[],
    dialect: SupportedDialect,
    liveColumnTypes: Map<string, Map<string, string>>
  ): RenameCandidate[] {
    // Step 2: MySQL combined-statement preprocessing.
    let normalized: string[] = statements;
    if (dialect === "mysql") {
      normalized = statements.flatMap(splitMysqlCombinedStatement);
    }

    // Step 3: SQLite recreate-pattern filtering.
    if (dialect === "sqlite") {
      normalized = filterSqliteRecreateBlocks(normalized);
    }

    // Steps 1+4: classify each statement, group by table.
    const dropsByTable = new Map<string, ParsedDropColumn[]>();
    const addsByTable = new Map<string, ParsedAddColumn[]>();

    for (const stmt of normalized) {
      const drop = parseDropColumn(stmt, dialect);
      if (drop) {
        const list = dropsByTable.get(drop.tableName) ?? [];
        list.push(drop);
        dropsByTable.set(drop.tableName, list);
        continue;
      }
      const add = parseAddColumn(stmt, dialect);
      if (add) {
        const list = addsByTable.get(add.tableName) ?? [];
        list.push(add);
        addsByTable.set(add.tableName, list);
      }
      // Other statements (CREATE TABLE, ALTER TYPE, etc.) silently ignored.
    }

    // Step 5: per-table Cartesian pairing.
    const candidates: RenameCandidate[] = [];
    for (const [tableName, drops] of dropsByTable) {
      const adds = addsByTable.get(tableName);
      if (!adds || adds.length === 0) continue;
      for (const drop of drops) {
        for (const add of adds) {
          const fromType =
            liveColumnTypes.get(tableName)?.get(drop.columnName) ?? "";
          const toType = add.columnType;
          const compatible =
            fromType === ""
              ? false
              : isTypesCompatible(fromType, toType, dialect);
          candidates.push({
            tableName,
            fromColumn: drop.columnName,
            toColumn: add.columnName,
            fromType,
            toType,
            typesCompatible: compatible,
            defaultSuggestion: compatible ? "rename" : "drop_and_add",
          });
        }
      }
    }

    // Step 6: deterministic sort by (tableName, fromColumn, toColumn).
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
