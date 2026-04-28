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

import type { Operation } from "../diff/types.js";
import type {
  Classifier,
  ClassificationLevel,
} from "../pushschema-pipeline-interfaces.js";
import {
  formatEventId,
  type ClassificationResult,
  type ClassifierEvent,
} from "../resolution/types.js";

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

    const level: ClassificationLevel =
      events.length > 0 ? "interactive" : "safe";
    return { level, events };
  }
}
