// Classing one column difference from the rows it holds: safe, lossy or blocked.
//
// The judgement itself is the shared one every path that changes a saved column uses
// (`value-conversion/`); this only says, for a difference `nextly repair-columns` found, what that
// judgement is asked: the column as it is and as its field expects it, how the field reads its
// values, and where the rows are.
//
// @module domains/schema/repair-columns/classify

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { isJsonBacked } from "../../../shared/lib/normalize-stored-value";
import {
  componentRelationshipHoldsReferenceList,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import { parseColumnType } from "../value-conversion/column-type";
import {
  judgeStoredColumn,
  type KeyedBy,
} from "../value-conversion/read-values";
import type {
  ColumnConversion,
  CompareAs,
  ConversionJudgement,
} from "../value-conversion/types";

import { buildColumnConversion, type ColumnConversionPlan } from "./conversion";
import { realToDoubleOnPostgres } from "./conversion/postgres";
import type { ColumnLocation, ColumnState, RepairEntityKind } from "./types";

/** Whether `column` is a JSON column. */
function isJson(column: ColumnState): boolean {
  return parseColumnType(column).family === "json";
}

/**
 * How a field reads its values: as JSON where its column is JSON or the field's value is stored as
 * JSON (`isJsonBacked`, the one rule for that; on SQLite such a column is text), as a number for a
 * single number, exactly otherwise.
 */
function compareAsFor(
  field: FieldDefinition,
  expected: ColumnState
): CompareAs {
  if (isJson(expected)) return "json";
  if (isJsonBacked(field)) return "json";
  if (field.type === "number" && field.hasMany !== true) return "number";
  return "exact";
}

/** One difference, as the classification needs it. */
export interface DifferenceToClass {
  kind: RepairEntityKind;
  field: FieldDefinition;
  location: ColumnLocation;
  live: ColumnState;
  expected: ColumnState;
  /**
   * The table and column as the database spells them. A column is matched to its field ignoring
   * case, so the database's spelling, not the field's, is the one a query can name.
   */
  liveTable: string;
  liveColumn: string;
  /** How the live table's rows are keyed, read from its primary key (`keyedByOf`). */
  keyedBy: KeyedBy;
}

/**
 * The conversion a difference asks for: from the live column to the one its field expects.
 *
 * A field group's relation that keeps its references on the row as a JSON list (a `hasMany` or a
 * many-to-many, by the rule the schema diff marks the same column with) is converted by reading each
 * stored value as a list of references, never as JSON text.
 */
function conversionFor(
  difference: DifferenceToClass,
  dialect: SupportedDialect
): ColumnConversion {
  const { kind, field, live, expected, location } = difference;
  const referenceList =
    kind === "fieldGroup" &&
    !location.translation &&
    componentRelationshipHoldsReferenceList(field) &&
    isJson(expected);
  return {
    dialect,
    from: live,
    to: expected,
    compareAs: compareAsFor(field, expected),
    ...(referenceList ? { referenceList: true } : {}),
    // The PostgreSQL conversion reads a real becoming a double through its text
    // (`conversion/postgres.ts`), so its judgement may count on it.
    ...(realToDoubleOnPostgres(live, expected, dialect)
      ? { throughText: true }
      : {}),
  };
}

/** The class of one difference, read from the rows its column holds. Changes nothing. */
export async function classifyDifference(
  db: unknown,
  dialect: SupportedDialect,
  difference: DifferenceToClass
): Promise<ConversionJudgement> {
  return judgeStoredColumn(db, conversionFor(difference, dialect), {
    table: difference.liveTable,
    column: difference.liveColumn,
    keyedBy: difference.keyedBy,
  });
}

/**
 * How one difference would convert on this database: its statements, what they cost while they run
 * and what the new type cannot keep, read from the live table. Null where the judgement found no
 * conversion for the pair of types, which has no statements to build. Changes nothing.
 */
export async function planDifference(
  db: unknown,
  dialect: SupportedDialect,
  difference: DifferenceToClass,
  judgement: ConversionJudgement
): Promise<ColumnConversionPlan | null> {
  if (judgement.reasons.some(reason => reason.kind === "no-conversion")) {
    return null;
  }
  // The same conversion the judgement read the rows for, so the statements and the judgement
  // agree on whether this is the list conversion.
  const conversion = conversionFor(difference, dialect);
  return buildColumnConversion(db, {
    dialect,
    table: difference.liveTable,
    column: difference.liveColumn,
    from: difference.live,
    to: difference.expected,
    ...(conversion.referenceList === true ? { referenceList: true } : {}),
  });
}
