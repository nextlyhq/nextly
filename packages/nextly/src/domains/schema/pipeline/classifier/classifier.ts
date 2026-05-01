// F5 + F6 Classifier. PR 2 ships NOT NULL detection. PR 3 adds type-change
// detection. UNIQUE/CHECK deferred to v2.
//
// Reads typed Operation[] from F4 Option E's diff engine. No regex parsing
// of drizzle-kit's text output for nullability changes — those come from
// our own structured operations.
//
// countNulls/countRows are dependency-injected so the classifier itself
// stays pure logic; the executor binds them to the live DB.

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";
import type {
  Classifier,
  ClassificationLevel,
} from "../pushschema-pipeline-interfaces";
import {
  formatEventId,
  type ClassificationResult,
  type ClassifierEvent,
} from "../resolution/types";

import { buildPerDialectWarning } from "./type-warnings";
import { isWideningChange } from "./type-widening";

export class RealClassifier implements Classifier {
  async classify(args: {
    operations: Operation[];
    drizzleWarnings: string[];
    hasDataLoss: boolean;
    countNulls: (table: string, column: string) => Promise<number>;
    countRows: (table: string) => Promise<number>;
    dialect: SupportedDialect;
  }): Promise<ClassificationResult> {
    const events: ClassifierEvent[] = [];

    for (const op of args.operations) {
      if (
        op.type === "change_column_nullable" &&
        op.fromNullable === true &&
        op.toNullable === false
      ) {
        // Tightening change: nullable -> NOT NULL. Pre-flight count tells
        // us whether existing data violates the new constraint.
        const nullCount = await args.countNulls(op.tableName, op.columnName);
        if (nullCount > 0) {
          const tableRowCount = await args.countRows(op.tableName);
          events.push({
            id: formatEventId(
              "add_not_null_with_nulls",
              op.tableName,
              op.columnName
            ),
            kind: "add_not_null_with_nulls",
            tableName: op.tableName,
            columnName: op.columnName,
            nullCount,
            tableRowCount,
            applicableResolutions: [
              "provide_default",
              "make_optional",
              "delete_nonconforming",
              "abort",
            ],
          });
        }
      } else if (op.type === "change_column_type") {
        // F6 type-change detection. Widenings (varchar(50) -> varchar(255),
        // smallint -> bigint, etc.) are provably safe and skip the warning.
        // Everything else surfaces a per-dialect warning so silent coercion
        // (MySQL/SQLite) and hard-failure (PG without USING) are loud.
        const widening = isWideningChange(op.fromType, op.toType, args.dialect);
        if (!widening) {
          events.push({
            id: formatEventId("type_change", op.tableName, op.columnName),
            kind: "type_change",
            tableName: op.tableName,
            columnName: op.columnName,
            fromType: op.fromType,
            toType: op.toType,
            isWidening: false,
            perDialectWarning: buildPerDialectWarning(op.fromType, op.toType),
          });
        }
      } else if (
        op.type === "add_column" &&
        op.column.nullable === false &&
        op.column.default === undefined
      ) {
        // Adding a required column with no default: existing rows would
        // need a value. Empty tables are fine; only emit on non-empty.
        // delete_nonconforming is NOT applicable because the column doesn't
        // exist yet — there's nothing to delete based on it.
        const tableRowCount = await args.countRows(op.tableName);
        if (tableRowCount > 0) {
          events.push({
            id: formatEventId(
              "add_required_field_no_default",
              op.tableName,
              op.column.name
            ),
            kind: "add_required_field_no_default",
            tableName: op.tableName,
            columnName: op.column.name,
            tableRowCount,
            applicableResolutions: [
              "provide_default",
              "make_optional",
              "abort",
            ],
          });
        }
      }
    }

    // Level rules:
    //   - "interactive" if any event has resolution choices (NOT-NULL kinds)
    //   - "destructive" if only type_change events (warning-only, no resolutions)
    //   - "safe" if no events at all
    const hasInteractive = events.some(e => e.kind !== "type_change");
    const level: ClassificationLevel = hasInteractive
      ? "interactive"
      : events.length > 0
        ? "destructive"
        : "safe";
    return { level, events };
  }
}
