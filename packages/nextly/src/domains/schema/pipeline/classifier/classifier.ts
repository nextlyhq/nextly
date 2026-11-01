// F5 + F6 Classifier. PR 2 ships NOT NULL detection. PR 3 adds type-change
// detection. UNIQUE/CHECK deferred to v2.
//
// Reads typed Operation[] from F4 Option E's diff engine. No regex parsing
// of drizzle-kit's text output for nullability changes — those come from
// our own structured operations.
//
// countNulls/countRows are dependency-injected so the classifier itself
// stays pure logic; the executor binds them to the live DB.

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { Operation } from "../diff/types";
import type {
  Classifier,
  ClassificationLevel,
} from "../pushschema-pipeline-interfaces";
import {
  formatEventId,
  type ClassificationResult,
  type ClassifierEvent,
  type DestructiveDropEvent,
} from "../resolution/types";

import { narrowingRefusal } from "./narrowing-refusal";
import { buildPerDialectWarning } from "./type-warnings";
import { isWideningChange, stringNarrowingLimit } from "./type-widening";

/**
 * A column drop with how many of its rows hold a value: what the data-loss
 * listing shows beside the column, since a drop of a column nobody filled in
 * loses nothing and one of a full column loses every row's value.
 */
interface CountedDropEvent extends DestructiveDropEvent {
  nonEmptyValues: number;
}

/**
 * The count of values a drop event carries, when the classifier counted
 * them. A dispatcher reads it through this, so an event built elsewhere
 * without one is listed without a count rather than refused.
 */
export function nonEmptyValuesOf(event: ClassifierEvent): number | undefined {
  return "nonEmptyValues" in event && typeof event.nonEmptyValues === "number"
    ? event.nonEmptyValues
    : undefined;
}

export class RealClassifier implements Classifier {
  async classify(args: {
    operations: Operation[];
    countNulls: (table: string, column: string) => Promise<number>;
    countRows: (table: string) => Promise<number>;
    countLongerThan?: (
      table: string,
      column: string,
      length: number
    ) => Promise<number>;
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
        // A string narrowed to varchar(N) is judged by its data: lossless when no stored value is
        // longer than N, so it needs no confirmation; otherwise every way of running it loses or
        // refuses data (MySQL cuts the value short without strict mode and fails with it), so the
        // apply stops here, before any DDL, and names what does not fit.
        const limit = stringNarrowingLimit(
          op.fromType,
          op.toType,
          args.dialect
        );
        if (limit !== null && args.countLongerThan !== undefined) {
          const longer = await args.countLongerThan(
            op.tableName,
            op.columnName,
            limit
          );
          if (longer === 0) continue;
          throw narrowingRefusal({
            tableName: op.tableName,
            columnName: op.columnName,
            fromType: op.fromType,
            toType: op.toType,
            limit,
            longer,
          });
        }
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
      } else if (op.type === "drop_column") {
        // Destructive drop — the data in this column will be lost. The
        // F4 RegexRenameDetector pairs drop_column + add_column into
        // rename candidates upstream, so any drop_column that reaches
        // the classifier is either:
        //   - a standalone removal from a code-first config (user
        //     deleted the field from nextly.config.ts), or
        //   - the user explicitly picked "drop_and_add" on a rename
        //     candidate.
        // Either way, prompt to confirm before destroying data. Row
        // count gives the user the magnitude of the loss.
        const tableRowCount = await args.countRows(op.tableName);
        const drop: DestructiveDropEvent = {
          id: formatEventId("destructive_drop", op.tableName, op.columnName),
          kind: "destructive_drop",
          tableName: op.tableName,
          columnName: op.columnName,
          columnType: op.columnType,
          tableRowCount,
          applicableResolutions: ["confirm_drop", "abort"],
        };
        // The rows that hold a value, which is what the drop loses, shown in
        // the data-loss listing. Only shown: a column the counter cannot read
        // (a name outside the identifiers it quotes) is still dropped as
        // consented, listed without its count, rather than failing the push.
        const nulls: unknown = await Promise.resolve()
          .then(() => args.countNulls(op.tableName, op.columnName))
          .catch(() => undefined);
        const counted: CountedDropEvent | DestructiveDropEvent =
          typeof nulls !== "number"
            ? drop
            : { ...drop, nonEmptyValues: tableRowCount - nulls };
        events.push(counted);
      }
    }

    // Level rules:
    //   - "interactive" when any event has user-resolved choices
    //     (NOT NULL kinds + destructive_drop)
    //   - "destructive" when only type_change events (warning-only)
    //   - "safe" when no events
    const hasInteractive = events.some(e => e.kind !== "type_change");
    const level: ClassificationLevel = hasInteractive
      ? "interactive"
      : events.length > 0
        ? "destructive"
        : "safe";
    return { level, events };
  }
}
