// One stored value under one conversion: whether it keeps its reading, and if not, why.
//
// Each value is judged as the conversion will store it on that database ("How values are copied"):
// PostgreSQL's cast refuses a value it cannot read and rounds one it can; MySQL's strict mode does
// the same; SQLite's rebuild copies each value into the new column, whose affinity may turn a text
// into a number, an integer into a real, or round one too large for a real. A value reads back the
// same when it compares equal as the field compares values: JSON by what it parses to, a number by
// its numeric value, anything else exactly.
//
// The pairs listed here are the conversions Nextly makes. Any other pair has none.
//
// @module domains/schema/value-conversion/judge-value

import { typesDiffer } from "../pipeline/diff/declared-size";

import {
  parseColumnType,
  sqliteAffinity,
  type ParsedType,
  type TypeFamily,
} from "./column-type";
import type {
  ColumnConversion,
  CompareAs,
  ConversionReasonKind,
  StoredValue,
} from "./types";
import {
  characterLength,
  exactNumber,
  keptByDouble,
  keptByFloat4,
  readsAsPostgresJson,
  readsAsPostgresTextArray,
  sqliteStores,
  type SqliteValue,
} from "./value-readings";

/**
 * What one non-null value gives: null when it keeps its reading, or the reason it does not.
 * A null is the column judgement's to weigh, since only nullability decides it.
 */
export type ValueJudge = (
  value: StoredValue & { text: string }
) => ConversionReasonKind | null;

/** A judge for a conversion every value survives: it changes no type a value is read through. */
export const keeps: ValueJudge = () => null;

const STRING_FAMILIES = new Set<TypeFamily>(["text", "varchar"]);
const INTEGER_WIDTH: Partial<Record<TypeFamily, number>> = {
  int2: 2,
  int4: 4,
  int8: 8,
};

/**
 * How `conversion` judges each value, or null when Nextly has no conversion for its pair of types.
 */
export function valueJudgeFor(conversion: ColumnConversion): ValueJudge | null {
  if (
    !typesDiffer(
      { name: "", ...conversion.from },
      { name: "", ...conversion.to }
    )
  ) {
    return keeps;
  }
  if (conversion.dialect === "sqlite") return sqliteJudge(conversion);
  const from = parseColumnType(conversion.from);
  const to = parseColumnType(conversion.to);
  if (conversion.referenceList) return referenceListJudge(conversion, to);
  return (
    jsonJudge(conversion, from, to) ??
    stringJudge(conversion, from, to) ??
    numberJudge(from, to)
  );
}

/**
 * Whether the database cannot keep a value written while the conversion runs: it checks the rows
 * and changes the column in separate transactions, and the old type can hold a value it would
 * accept and store as a different one.
 *
 * Only MySQL commits each schema statement on its own. Of its pairs, an integer becoming a double or
 * a float can be rounded, and so can a decimal of more significant digits than a double holds; every
 * other pair Nextly converts keeps each value of its old type or has strict mode refuse it.
 */
export function lateWriteCanChange(conversion: ColumnConversion): boolean {
  if (conversion.dialect !== "mysql") return false;
  const from = parseColumnType(conversion.from);
  const to = parseColumnType(conversion.to);
  const width = INTEGER_WIDTH[from.family];
  if (to.family === "float8") {
    // A MySQL decimal stated without a precision holds ten digits.
    if (from.family === "numeric") return (from.precision ?? 10) > 15;
    return width !== undefined && width > 4;
  }
  if (to.family === "float4") return width !== undefined && width > 2;
  return false;
}

/**
 * A relation's stored value read as the list it becomes. The list conversion reads any column
 * through its text (`reference-list-conversion.ts`), so every old type converts, a number included.
 */
function referenceListJudge(
  conversion: ColumnConversion,
  to: ParsedType
): ValueJudge | null {
  if (to.family !== "json") return null;
  // MySQL's conversion wraps every value that is not a JSON list in one, so it reads every value.
  if (conversion.dialect === "mysql") return keeps;
  return ({ text }) =>
    postgresReadsReferenceList(text) ? null : "unreadable-reference-list";
}

/**
 * Whether PostgreSQL's list conversion reads `text`, branch by branch as its expression does: an
 * empty value (spaces trimmed) is an empty list, one starting `{` an array literal, one starting `[`
 * or `"` JSON, and anything else a single id.
 */
function postgresReadsReferenceList(text: string): boolean {
  const value = text.replace(/^ +| +$/g, "");
  if (value === "") return true;
  const first = value.charAt(0);
  if (first === "{") return readsAsPostgresTextArray(text);
  if (first === "[" || first === '"') return readsAsPostgresJson(text);
  return true;
}

/**
 * One JSON type becoming the other. PostgreSQL's `jsonb` refuses some JSON its `json` type keeps
 * (see `readsAsPostgresJson`); MySQL has one JSON type.
 */
function jsonJudge(
  conversion: ColumnConversion,
  from: ParsedType,
  to: ParsedType
): ValueJudge | null {
  if (from.family !== "json" || to.family !== "json") return null;
  if (conversion.dialect !== "postgresql") return keeps;
  return ({ text }) => (readsAsPostgresJson(text) ? null : "not-json");
}

/** A string becoming JSON, a shorter or longer string. */
function stringJudge(
  conversion: ColumnConversion,
  from: ParsedType,
  to: ParsedType
): ValueJudge | null {
  if (!STRING_FAMILIES.has(from.family)) return null;
  if (to.family === "json") {
    if (conversion.dialect === "mysql") {
      return ({ text, jsonValid }) =>
        (jsonValid ?? parses(text)) ? null : "not-json";
    }
    return ({ text }) => (readsAsPostgresJson(text) ? null : "not-json");
  }
  if (to.family === "text") return keeps;
  if (to.family === "varchar") {
    const limit = to.length;
    if (limit === undefined) return keeps;
    return ({ text }) => (characterLength(text) > limit ? "too-long" : null);
  }
  return null;
}

/** Whether JavaScript's parser reads `text` as JSON. */
function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** A number becoming a wider integer, a double or a float. */
function numberJudge(from: ParsedType, to: ParsedType): ValueJudge | null {
  const fromWidth = INTEGER_WIDTH[from.family];
  const toWidth = INTEGER_WIDTH[to.family];
  if (fromWidth !== undefined && toWidth !== undefined) {
    return toWidth >= fromWidth ? keeps : null;
  }
  const isNumber = fromWidth !== undefined || from.family === "numeric";
  if (isNumber && to.family === "float8") {
    return ({ text }) => (keptByDouble(text) ? null : "stored-differently");
  }
  if (fromWidth !== undefined && to.family === "float4") {
    return ({ text }) => (keptByFloat4(text) ? null : "stored-differently");
  }
  return null;
}

/**
 * SQLite's rebuild: every value is copied into the new column, which applies its affinity. Where
 * the affinity does not change, values are copied as stored and every one keeps its reading.
 */
function sqliteJudge(conversion: ColumnConversion): ValueJudge {
  const before = sqliteAffinity(conversion.from.type);
  const after = sqliteAffinity(conversion.to.type);
  if (before === after) return keeps;
  return ({ text, storage, exactReal }) => {
    const stored: SqliteValue = {
      text,
      storage: storage ?? "text",
      ...(exactReal !== undefined ? { exact: exactReal } : {}),
    };
    return sameReading(
      stored,
      sqliteStores(stored, after),
      conversion.compareAs
    );
  };
}

/**
 * Whether a value SQLite stores as `after` reads as `before` did, compared as the field compares.
 *
 * A number field reads a text that is not a number as nothing, so a value the new column keeps as
 * such a text cannot be held by it. A JSON field on SQLite reads text, so it compares as stored.
 */
function sameReading(
  before: SqliteValue,
  after: SqliteValue,
  compareAs: CompareAs
): ConversionReasonKind | null {
  if (compareAs === "number") {
    const read = exactNumber(after.text);
    if (read === null) return "kept-unreadable";
    // A REAL is a double, so it keeps its reading when the new value reads as that same double.
    if (before.storage === "real") {
      return Number(after.text) === Number(before.exact ?? before.text)
        ? null
        : "stored-differently";
    }
    return read === exactNumber(before.text) ? null : "stored-differently";
  }
  return before.storage === after.storage &&
    (before.exact ?? before.text) === (after.exact ?? after.text)
    ? null
    : "stored-differently";
}
