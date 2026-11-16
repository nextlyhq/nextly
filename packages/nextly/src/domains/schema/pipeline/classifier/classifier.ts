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

import type { ChangeColumnTypeOp, Operation } from "../diff/types";
import type {
  Classifier,
  ClassificationLevel,
} from "../pushschema-pipeline-interfaces";
import {
  formatEventId,
  type ClassificationResult,
  type ClassifierEvent,
  type DestructiveDropEvent,
  type ResolutionKind,
  type SafeConversion,
  type TypeChangeEvent,
} from "../resolution/types";

import { conversionRefusal, type JudgedConversion } from "./conversion-refusal";
import type { TypeChangeJudge } from "./judge-type-change";
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

/**
 * Whether a column-type change asks to be confirmed. A widening is provably safe. A column
 * becoming a relation's list of references keeps every value, each id as a one-item list
 * (`referenceList`), so there is nothing to confirm either. The way back to one reference still
 * asks: a row holding several is refused, and the switch is the author's to confirm.
 */
function typeChangeAsks(op: ChangeColumnTypeOp, widening: boolean): boolean {
  return !widening && op.conversion !== "referenceList";
}

/**
 * Whether the repair command's rule judges a type change: a plain cast, or a column becoming a
 * relation's list of references. The way back to one reference and a switch to or from several
 * collections keep refusals of their own, which no cast reaches.
 */
function ruleJudges(op: ChangeColumnTypeOp): boolean {
  return op.conversion === undefined || op.conversion === "referenceList";
}

/**
 * Adds one ruled type change to what it belongs with; false for one the rule did not judge, which
 * the classifier offers as before.
 */
function collectRuled(
  ruled: RuledTypeChange,
  into: {
    events: ClassifierEvent[];
    safeConversions: SafeConversion[];
    blocked: JudgedConversion[];
  }
): boolean {
  switch (ruled.kind) {
    case "safe":
      into.safeConversions.push(ruled.safe);
      return true;
    case "event":
      into.events.push(ruled.event);
      return true;
    case "blocked":
      into.blocked.push(ruled.blocked);
      return true;
    case "unjudged":
      return false;
  }
}

/**
 * The classification of `events`, and, where the rule judged type changes, the safe ones. Every
 * blocked conversion is refused at once, before any prompt and any statement, so the owner sees all
 * of them in one run rather than one per try.
 *
 * Level rules:
 *   - "interactive" when any event has user-resolved choices (NOT NULL kinds + destructive_drop)
 *   - "destructive" when only type_change events (warning-only)
 *   - "safe" when no events
 */
function classificationOf(
  events: ClassifierEvent[],
  ruled:
    | {
        safeConversions: SafeConversion[];
        blocked: JudgedConversion[];
        nextStep: string | undefined;
      }
    | undefined
): ClassificationResult {
  if (ruled !== undefined && ruled.blocked.length > 0) {
    throw conversionRefusal(ruled.blocked, ruled.nextStep ?? "apply again");
  }
  const hasInteractive = events.some(e => e.kind !== "type_change");
  const level: ClassificationLevel = hasInteractive
    ? "interactive"
    : events.length > 0
      ? "destructive"
      : "safe";
  return ruled === undefined
    ? { level, events }
    : { level, events, safeConversions: ruled.safeConversions };
}

/** What one type change judged by the rule adds to the classification. */
type RuledTypeChange =
  | { kind: "unjudged" }
  | { kind: "safe"; safe: SafeConversion }
  | { kind: "event"; event: TypeChangeEvent }
  | { kind: "blocked"; blocked: JudgedConversion };

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
    /** Whether a column is unique in the schema being applied (`uniqueColumnLookup`). */
    isUnique?: (table: string, column: string) => boolean;
    dialect: SupportedDialect;
    /**
     * The repair command's rule, bound to the live rows (`typeChangeJudge`), which `db:sync` and
     * the development push class every type change they offer by. Absent (a Schema Builder save),
     * a type change is offered as a warning to confirm.
     */
    judgeConversion?: TypeChangeJudge;
    /** The step that tries a refused conversion again, which its refusal ends with. */
    nextStep?: string;
  }): Promise<ClassificationResult> {
    const events: ClassifierEvent[] = [];
    const safeConversions: SafeConversion[] = [];
    const blocked: JudgedConversion[] = [];
    // One value written to every row it fills repeats in a unique column, or collides with a value
    // a row already holds, so "fill with one value" is never offered for one.
    const offered = (
      table: string,
      column: string,
      answers: ResolutionKind[]
    ): ResolutionKind[] =>
      args.isUnique?.(table, column) === true
        ? answers.filter(answer => answer !== "provide_default")
        : answers;

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
            applicableResolutions: offered(op.tableName, op.columnName, [
              "provide_default",
              "make_optional",
              "delete_nonconforming",
              "abort",
            ]),
          });
        }
      } else if (op.type === "change_column_type") {
        // F6 type-change detection (`classifyTypeChange`).
        await this.classifyTypeChange(op, args, {
          events,
          safeConversions,
          blocked,
        });
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
            applicableResolutions: offered(op.tableName, op.column.name, [
              "provide_default",
              "make_optional",
              "abort",
            ]),
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

    return classificationOf(
      events,
      args.judgeConversion === undefined
        ? undefined
        : { safeConversions, blocked, nextStep: args.nextStep }
    );
  }

  /**
   * One type change, added to what it belongs with. Widenings (varchar(50) -> varchar(255),
   * smallint -> bigint, etc.) are provably safe and skip the warning. Everything else surfaces a
   * per-dialect warning so silent coercion (MySQL/SQLite) and hard-failure (PG without USING) are
   * loud, unless the repair command's rule judges it first.
   */
  private async classifyTypeChange(
    op: ChangeColumnTypeOp,
    args: Parameters<RealClassifier["classify"]>[0],
    into: {
      events: ClassifierEvent[];
      safeConversions: SafeConversion[];
      blocked: JudgedConversion[];
    }
  ): Promise<void> {
    const { events } = into;
    const widening = isWideningChange(op.fromType, op.toType, args.dialect);
    // Judged by the repair command's rule where the caller gives it. A widening is judged too:
    // on SQLite a value its old column kept as text can stay unreadable in the new one. One the
    // rule has no conversion for stays a widening, made without a word as before.
    const ruled =
      args.judgeConversion !== undefined && ruleJudges(op)
        ? await this.judgeTypeChange(op, args.judgeConversion, {
            ...args,
            widening,
          })
        : { kind: "unjudged" as const };
    if (collectRuled(ruled, into)) {
      return;
    }
    // A string narrowed to varchar(N) is judged by its data: lossless when no stored value is
    // longer than N, so it needs no confirmation; otherwise every way of running it loses or
    // refuses data (MySQL cuts the value short without strict mode and fails with it), so the
    // apply stops here, before any DDL, and names what does not fit.
    const limit = stringNarrowingLimit(op.fromType, op.toType, args.dialect);
    if (limit !== null && args.countLongerThan !== undefined) {
      const longer = await args.countLongerThan(
        op.tableName,
        op.columnName,
        limit
      );
      if (longer === 0) return;
      throw narrowingRefusal({
        tableName: op.tableName,
        columnName: op.columnName,
        fromType: op.fromType,
        toType: op.toType,
        limit,
        longer,
      });
    }
    if (typeChangeAsks(op, widening)) {
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
  }

  /**
   * One type change judged by the repair command's rule: safe goes ahead, lossy is an event its
   * consent decides, blocked is refused. A pair the rule has no conversion for, or a column the
   * judge cannot find, is offered as before; the former with how many rows hold a value, unless it
   * is a widening, which is made as before without one.
   */
  private async judgeTypeChange(
    op: ChangeColumnTypeOp,
    judge: TypeChangeJudge,
    args: {
      countNulls: (table: string, column: string) => Promise<number>;
      countRows: (table: string) => Promise<number>;
      dialect: SupportedDialect;
      widening: boolean;
    }
  ): Promise<RuledTypeChange> {
    const judged = await judge(op);
    if (judged === null) return { kind: "unjudged" };
    const { judgement } = judged;
    const offered: TypeChangeEvent = {
      id: formatEventId("type_change", op.tableName, op.columnName),
      kind: "type_change",
      tableName: op.tableName,
      columnName: op.columnName,
      fromType: op.fromType,
      toType: op.toType,
      isWidening: false,
      perDialectWarning: buildPerDialectWarning(op.fromType, op.toType),
      dialect: args.dialect,
    };
    if (judgement.reasons.some(reason => reason.kind === "no-conversion")) {
      if (args.widening) return { kind: "unjudged" };
      const rows = await args.countRows(op.tableName);
      const nulls = await args.countNulls(op.tableName, op.columnName);
      return {
        kind: "event",
        event: { ...offered, rowsHoldingValue: rows - nulls },
      };
    }
    if (judgement.class === "blocked") {
      return {
        kind: "blocked",
        blocked: {
          tableName: op.tableName,
          columnName: op.columnName,
          fromType: op.fromType,
          toType: op.toType,
          judgement,
        },
      };
    }
    if (judgement.class === "lossy") {
      return {
        kind: "event",
        event: {
          ...offered,
          lossy: {
            judgement,
            keyedBy: judged.keyedBy,
            cleared: judged.cleared,
            conversion: judged.conversion,
          },
        },
      };
    }
    return {
      kind: "safe",
      safe: {
        tableName: op.tableName,
        columnName: op.columnName,
        fromType: op.fromType,
        toType: op.toType,
        rowsChecked: await args.countRows(op.tableName),
      },
    };
  }
}
