/**
 * What a value moved out of a group must be for the column it moves to to keep it as the same
 * value, by the column's kind, on each dialect: judged on every entry before a save writes
 * anything, so a move that the copy would change, cut or fail on is refused instead, naming the
 * entries.
 *
 * The group's JSON holds whatever entry validation let in, which is wider than some columns: a
 * text longer than a `varchar`, a decimal with more digits than its scale, a number outside an
 * integer's range, a date with milliseconds a TIMESTAMP rounds away, a checkbox value that is
 * neither true nor false. Left to the copy, PostgreSQL rolls the file back, MySQL (strict) stops
 * part-way after the column is added, and a cast that fits by rounding (a decimal's scale, MySQL's
 * seconds) or by reading anything as false (a boolean on MySQL and SQLite) changes the value
 * without saying so.
 *
 * The kinds judged here are every kind a Builder field's column can take
 * (`classifyFieldKind`): a kind not named keeps every value its copy reads. `json` carries any
 * JSON value as itself, and the text kinds without a width (PostgreSQL's and SQLite's `text`)
 * carry any value as its text.
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import type { ColumnKind } from "../services/field-column-descriptor";

import { movesAsTheSameDate } from "./move-statements";

/** The column a value moves to: its kind, its SQL type, and a decimal's digits. */
export interface KeptColumn {
  kind: ColumnKind;
  columnType: string;
  precision?: number;
  scale?: number;
}

/** A value as the check reads it out of the group: its JSON type's name and its text. */
export interface HeldValue {
  type: unknown;
  text: unknown;
}

/**
 * What a column keeps: `noun` names the value in a refusal, `keeps` judges one held value, and
 * `ask` says what to write instead, for one entry (`it`) or several (`each`).
 */
export interface KeptValues {
  noun: string;
  keeps: (held: HeldValue) => boolean;
  ask: (each: string) => string;
}

/**
 * What a refused date must be, past an ISO date, for each dialect's column to keep it as the same
 * date (`movesAsTheSameDate`): MySQL's TIMESTAMP holds whole seconds in its own range, SQLite
 * whole seconds.
 */
const DATES_KEPT: Record<SupportedDialect, string> = {
  postgresql: "",
  mysql:
    " in whole seconds, from 1970-01-01T00:00:01Z to 2038-01-19T03:14:07Z, the dates MySQL's column holds",
  sqlite: " in whole seconds",
};

/** The whole numbers an integer column holds on PostgreSQL (int4) and MySQL (int). */
export const INT_RANGE = { least: -2147483648, most: 2147483647 } as const;

/** The bytes MySQL's `text` holds, the column a long text field takes there. */
const MYSQL_TEXT_BYTES = 65535;

/** The kinds stored as a string, whose column may bound its width. */
const STRING_KINDS: ReadonlySet<ColumnKind> = new Set<ColumnKind>([
  "text",
  "longText",
  "shortText",
  "varchar",
  "char",
  "fkSingle",
]);

/** A JSON number's text, as each dialect's cast reads it. */
const JSON_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * What `column` keeps on `dialect`, where it keeps less than a group's JSON can hold; undefined
 * where it keeps every value its copy reads.
 */
export function keptValuesOf(
  column: KeptColumn,
  dialect: SupportedDialect
): KeptValues | undefined {
  switch (column.kind) {
    case "timestamp":
      return {
        noun: "date",
        keeps: held => readsAsTheSameDate(held, dialect),
        ask: each =>
          `Write ${each} as an ISO date${DATES_KEPT[dialect]}, such as 2026-07-17 or 2026-07-17T10:00:00Z`,
      };
    case "boolean":
      return {
        noun: "checkbox value",
        keeps: readsAsTheSameBoolean,
        ask: each => `Write ${each} as true or false`,
      };
    default:
      // SQLite stores a number or a string as it is: its integer holds every whole number a JSON
      // value from JavaScript can, and its numeric and text columns take any width.
      return dialect === "sqlite"
        ? undefined
        : (numberKept(column) ?? stringKept(column, dialect));
  }
}

/** What a numeric column keeps on PostgreSQL and MySQL, whose casts refuse or round the rest. */
function numberKept(column: KeptColumn): KeptValues | undefined {
  if (column.kind === "integer") {
    return {
      noun: "number",
      keeps: held => isWholeNumberInRange(String(held.text)),
      ask: each =>
        `Write ${each} as a whole number from ${INT_RANGE.least} to ${INT_RANGE.most}`,
    };
  }
  if (column.kind === "double") {
    return {
      noun: "number",
      keeps: held => JSON_NUMBER.test(String(held.text)),
      ask: each => `Write ${each} as a number`,
    };
  }
  if (
    column.kind === "decimal" &&
    column.precision !== undefined &&
    column.scale !== undefined
  ) {
    const { precision, scale } = column;
    return {
      noun: "number",
      keeps: held => fitsDecimal(String(held.text), precision, scale),
      ask: each =>
        `Write ${each} as a number with at most ${precision - scale} digits before the point and ${scale} after it`,
    };
  }
  return undefined;
}

/** What a string column of a bounded width keeps on PostgreSQL and MySQL. */
function stringKept(
  column: KeptColumn,
  dialect: SupportedDialect
): KeptValues | undefined {
  if (!STRING_KINDS.has(column.kind)) return undefined;
  const width = /^(?:varchar|char)\((\d+)\)$/i.exec(column.columnType)?.[1];
  if (width !== undefined) {
    const most = Number(width);
    return {
      noun: "text",
      // Both count characters, not bytes or UTF-16 units: a character outside the BMP is one.
      keeps: held => Array.from(String(held.text)).length <= most,
      ask: each => `Write ${each} in at most ${most} characters`,
    };
  }
  if (dialect === "mysql" && column.columnType.toLowerCase() === "text") {
    return {
      noun: "text",
      keeps: held =>
        new TextEncoder().encode(String(held.text)).length <= MYSQL_TEXT_BYTES,
      ask: each => `Write ${each} in at most ${MYSQL_TEXT_BYTES} bytes`,
    };
  }
  return undefined;
}

/** Whether a value read out of a group is a string the copy reads as the same date. */
function readsAsTheSameDate(
  held: HeldValue,
  dialect: SupportedDialect
): boolean {
  const type = String(held.type).toLowerCase();
  return (
    (type === "string" || type === "text") &&
    movesAsTheSameDate(String(held.text), dialect)
  );
}

/**
 * Whether a value read out of a group is one every dialect's copy reads as the same boolean: JSON
 * true or false, the numbers 1 and 0, or the strings "true" and "false". Any other value reads
 * as false on MySQL and SQLite and as something else, or not at all, on PostgreSQL ("yes" is true
 * there, 2 is refused).
 */
function readsAsTheSameBoolean(held: HeldValue): boolean {
  const type = String(held.type).toLowerCase();
  const text = String(held.text);
  // SQLite names a JSON boolean's type `true` or `false`, and reads its text as 1 or 0.
  if (type === "boolean" || type === "true" || type === "false") return true;
  if (type === "number" || type === "integer") {
    return text === "0" || text === "1";
  }
  if (type === "string" || type === "text") {
    return text === "true" || text === "false";
  }
  return false;
}

/** Whether a value's text is a whole number an integer column holds, as the copy casts it. */
function isWholeNumberInRange(text: string): boolean {
  if (!/^-?\d{1,10}$/.test(text)) return false;
  const value = Number(text);
  return value >= INT_RANGE.least && value <= INT_RANGE.most;
}

/**
 * Whether a JSON number's text fits a decimal of `precision` digits, `scale` of them after the
 * point, exactly: no digit past the scale that the cast would round away, and no more digits
 * before the point than the column holds. Read from the text, so `1.239` is three places whatever
 * a binary double would make of it; trailing zeros after the point and leading zeros before it
 * count for nothing, and an exponent (`1e-7`, as JavaScript writes small numbers) moves the point.
 */
export function fitsDecimal(
  text: string,
  precision: number,
  scale: number
): boolean {
  const parts = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (parts === null) return false;
  const [, whole = "", fraction = "", exponent = "0"] = parts;
  const digits = `${whole}${fraction}`;
  // Where the point falls in `digits` once the exponent has moved it.
  const point = whole.length + Number(exponent);
  const significant = digits.replace(/0+$/, "");
  const after = Math.max(0, significant.length - point);
  const before = Math.max(
    0,
    point - (digits.length - digits.replace(/^0+/, "").length)
  );
  return after <= scale && before <= precision - scale;
}
