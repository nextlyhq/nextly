// Classing one column difference from the rows it holds: safe, lossy or blocked.
//
// The judgement itself is the shared one every path that changes a saved column uses
// (`value-conversion/`); this only says, for a difference `nextly repair-columns` found, what that
// judgement is asked: the column as it is and as its field expects it, how the field reads its
// values, and where the rows are.
//
// @module domains/schema/repair-columns/classify

import type { FieldDefinition } from "../../../schemas/dynamic-collections";
import { normalizeType } from "../pipeline/diff/normalize-type";
import {
  usesJunctionTable,
  type SupportedDialect,
} from "../services/field-column-descriptor";
import { judgeStoredColumn } from "../value-conversion/read-values";
import type {
  ColumnConversion,
  CompareAs,
  ConversionJudgement,
} from "../value-conversion/types";

import type { ColumnLocation, ColumnState, RepairEntityKind } from "./types";

/** Field types whose value is a JSON document wherever it is stored. */
const STRUCTURED_FIELD_TYPES = new Set(["repeater", "group", "json"]);

/** Whether `type` is a JSON column. */
function isJsonType(type: string): boolean {
  const normalized = normalizeType(type);
  return normalized === "json" || normalized === "jsonb";
}

/**
 * How a field reads its values: as JSON where its column is JSON or the field is a structured
 * one (on SQLite, whose JSON columns are text), as a number for a single number, exactly otherwise.
 */
function compareAsFor(
  field: FieldDefinition,
  expected: ColumnState
): CompareAs {
  if (isJsonType(expected.type)) return "json";
  if (STRUCTURED_FIELD_TYPES.has(String(field.type))) return "json";
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
}

/**
 * The conversion a difference asks for: from the live column to the one its field expects.
 *
 * A field group's many-to-many keeps its references on the row as a JSON list, and such a column
 * is converted by reading each stored value as a list of references, never as JSON text.
 */
function conversionFor(
  difference: DifferenceToClass,
  dialect: SupportedDialect
): ColumnConversion {
  const { kind, field, live, expected, location } = difference;
  const referenceList =
    kind === "fieldGroup" &&
    !location.translation &&
    usesJunctionTable(field) &&
    isJsonType(expected.type);
  return {
    dialect,
    from: live,
    to: expected,
    compareAs: compareAsFor(field, expected),
    ...(referenceList ? { referenceList: true } : {}),
  };
}

/** The class of one difference, read from the rows its column holds. Changes nothing. */
export async function classifyDifference(
  db: unknown,
  dialect: SupportedDialect,
  difference: DifferenceToClass
): Promise<ConversionJudgement> {
  return judgeStoredColumn(db, conversionFor(difference, dialect), {
    table: difference.location.table,
    column: difference.location.column,
    keyedBy: difference.location.translation ? "translation" : "id",
  });
}
