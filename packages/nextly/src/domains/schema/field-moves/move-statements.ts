/**
 * The statements a migration file carries to keep a moved field's values: copying each entry's
 * value from where the field was to where it now is, and clearing the place it left. They are data
 * statements only; the column a move adds or drops is the schema change's own.
 *
 * Their order is the guarantee that nothing is lost, on every dialect and wherever a run stops:
 * the place the values go to exists before `copy` runs, and the place they leave is cleared (by
 * `clearSource`, or by dropping its column) only after it. An entry's value is always in one of
 * the two places, and in both while a run is between them.
 *
 * A value keeps its meaning across the move: in a group's JSON it is written as the entry's value
 * is written there (a boolean as `true` or `false`, a date as its ISO string, a JSON value as
 * JSON), and in a column as that column stores it. Entries with no value are left as they are.
 *
 * @module domains/schema/field-moves/move-statements
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { MEDIA_USAGE_TABLE } from "../../../schemas/media-usage/table-name";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { VersionsWhereCondition } from "../../versions/db-api";
import { WORKING_DRAFT_SHAPE } from "../../versions/versions-repository";
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import {
  toSnakeCase,
  type ColumnKind,
} from "../services/field-column-descriptor";
import { boundedIdentifier } from "../services/index-name";

import type { StoragePlace } from "./check-move";

/** The table a move runs on, and the moved field's column: its kind and its type there. */
export interface MoveColumn {
  table: string;
  dialect: SupportedDialect;
  kind: ColumnKind;
  /** The column's SQL type, which a value read out of JSON is cast to. */
  columnType: string;
  /** A decimal's digits, and those after the point, which a value read into it must fit. */
  precision?: number;
  scale?: number;
}

export interface MoveDataStatements {
  /**
   * Stops the run, before the file changes anything, where an entry of the database it runs on
   * holds a value the copy would not keep as it is (`unkeptValuesStop`); empty where every value
   * is kept.
   */
  stop: string[];
  /** Writes each entry's value where the field now is; runs once that place exists. */
  copy: string[];
  /** Clears a key the field left; a column it left is dropped by the schema change instead. */
  clearSource: string[];
}

/** The kinds stored as text, read out of JSON with no cast. */
const TEXT_KINDS: ReadonlySet<ColumnKind> = new Set<ColumnKind>([
  "text",
  "longText",
  "shortText",
  "varchar",
  "char",
  "enum",
]);

/** A key as a JSON path segment: refused where it would need escaping, which no field name does. */
function safeKey(key: string): string {
  if (!/^[A-Za-z0-9_$-]+$/.test(key)) {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "A moved field's name cannot be written as a JSON key.",
      logContext: { key },
    });
  }
  return key;
}

/** One dialect's JSON functions over a column and a path of keys. */
interface JsonDialect {
  /** The value at `keys`, as JSON. */
  valueAt(column: string, keys: readonly string[]): string;
  /** Whether a value other than JSON null is at `keys`. */
  holds(column: string, keys: readonly string[]): string;
  /** Whether `keys` is there at all, null included. */
  hasKey(column: string, keys: readonly string[]): string;
  /** The column's JSON with `value` set at `keys`, the column taken as an empty object when NULL. */
  set(column: string, keys: readonly string[], value: string): string;
  remove(column: string, keys: readonly string[]): string;
  emptyObject: string;
  /** JSON null, as a value to set at a key. */
  jsonNull: string;
  /** Whether the value at `keys` is an object, so a key can be set inside it. */
  isObject(column: string, keys: readonly string[]): string;
  /** Whether the value at `keys` (the whole column, with none) is an object with no keys. */
  isEmptyObject(column: string, keys: readonly string[]): string;
  /** A column's value as the JSON a group holds for it. */
  toJson(column: string, target: MoveColumn): string;
  /** The value at `keys` as `target`'s column stores it. */
  fromJson(column: string, keys: readonly string[], target: MoveColumn): string;
}

const pgPath = (keys: readonly string[]) =>
  `'{${keys.map(key => `"${safeKey(key)}"`).join(",")}}'`;
const dollarPath = (keys: readonly string[]) =>
  `'$${keys.map(key => `."${safeKey(key)}"`).join("")}'`;

/**
 * Whether a PostgreSQL timestamp column keeps its zone: `timestamptz` or `timestamp with time
 * zone`; the spelled-out `timestamp without time zone` holds a plain time, as `timestamp` does.
 */
const zoned = (columnType: string) =>
  !/without time zone/i.test(columnType) &&
  /with time zone|timestamptz/i.test(columnType);

/** An ISO date's trailing offset (`Z`, `+05:00`), which MySQL's casts do not read. */
const ISO_OFFSET = "'(Z|[+-][0-9]{2}:[0-9]{2})$'";

const POSTGRES: JsonDialect = {
  valueAt: (c, k) => `${c} #> ${pgPath(k)}`,
  holds: (c, k) =>
    `jsonb_typeof(${c} #> ${pgPath(k)}) IS NOT NULL AND jsonb_typeof(${c} #> ${pgPath(k)}) <> 'null'`,
  hasKey: (c, k) => `(${c} #> ${pgPath(k)}) IS NOT NULL`,
  set: (c, k, v) =>
    `jsonb_set(COALESCE(${c}, '{}'::jsonb), ${pgPath(k)}, ${v}, true)`,
  remove: (c, k) => `${c} #- ${pgPath(k)}`,
  emptyObject: "'{}'::jsonb",
  jsonNull: "'null'::jsonb",
  isObject: (c, k) => `jsonb_typeof(${c} #> ${pgPath(k)}) = 'object'`,
  isEmptyObject: (c, k) => `(${c} #> ${pgPath(k)}) = '{}'::jsonb`,
  toJson: (c, target) => {
    if (target.kind === "json") return c;
    if (target.kind === "timestamp") {
      // A zone-aware column is first read at UTC; a plain one already holds UTC.
      const utc = zoned(target.columnType) ? `${c} AT TIME ZONE 'UTC'` : c;
      return `to_jsonb(to_char(${utc}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))`;
    }
    return `to_jsonb(${c})`;
  },
  fromJson: (c, k, target) => {
    if (target.kind === "json") return `${c} #> ${pgPath(k)}`;
    const text = `${c} #>> ${pgPath(k)}`;
    if (target.kind === "timestamp") {
      // Read as an instant, whatever offset it was written with; a plain column holds it at UTC.
      // A date alone (the one form `movesAsTheSameDate` lets through with no offset) is midnight
      // at UTC, as JavaScript reads it, never in the session's zone.
      const instant = `(${text} || CASE WHEN length(${text}) = 10 THEN 'T00:00:00Z' ELSE '' END)::timestamptz`;
      return zoned(target.columnType)
        ? instant
        : `(${instant} AT TIME ZONE 'UTC')`;
    }
    return TEXT_KINDS.has(target.kind)
      ? text
      : `(${text})::${target.columnType}`;
  },
};

const MYSQL: JsonDialect = {
  valueAt: (c, k) => `JSON_EXTRACT(${c}, ${dollarPath(k)})`,
  holds: (c, k) =>
    `JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)})) IS NOT NULL AND JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)})) <> 'NULL'`,
  hasKey: (c, k) => `JSON_CONTAINS_PATH(${c}, 'one', ${dollarPath(k)})`,
  set: (c, k, v) =>
    `JSON_SET(COALESCE(${c}, JSON_OBJECT()), ${dollarPath(k)}, ${v})`,
  remove: (c, k) => `JSON_REMOVE(${c}, ${dollarPath(k)})`,
  emptyObject: "JSON_OBJECT()",
  jsonNull: "CAST('null' AS JSON)",
  isObject: (c, k) =>
    `JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)})) = 'OBJECT'`,
  isEmptyObject: (c, k) =>
    `(JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)})) = 'OBJECT' AND JSON_LENGTH(JSON_EXTRACT(${c}, ${dollarPath(k)})) = 0)`,
  toJson: (c, target) => {
    if (target.kind === "boolean") {
      return `IF(${c}, CAST('true' AS JSON), CAST('false' AS JSON))`;
    }
    if (target.kind === "timestamp") {
      // Milliseconds, as a date is written in an entry's JSON.
      return `CONCAT(DATE_FORMAT(${c}, '%Y-%m-%dT%H:%i:%s.'), LPAD(FLOOR(MICROSECOND(${c}) / 1000), 3, '0'), 'Z')`;
    }
    return c;
  },
  fromJson: (c, k, target) => {
    const value = `JSON_EXTRACT(${c}, ${dollarPath(k)})`;
    const read = MYSQL_READS[target.kind] ?? (text => text);
    return read(`JSON_UNQUOTE(${value})`, value, target);
  },
};

/**
 * How MySQL reads a value out of JSON into a column of each kind, from its unquoted text (or, for
 * a JSON column, the JSON value itself); a kind not named here is stored as the text.
 */
const MYSQL_READS: Partial<
  Record<
    ColumnKind,
    (text: string, value: string, target: MoveColumn) => string
  >
> = {
  json: (_, value) => value,
  boolean: text => `IF(${text} IN ('true', '1'), 1, 0)`,
  timestamp: text => {
    // The column holds UTC: the local part is read, then its offset taken off in minutes by
    // arithmetic, which keeps no range of its own. Whether the column holds the instant is
    // judged before the move, by `movesAsTheSameDate`.
    const offset = `REGEXP_SUBSTR(${text}, ${ISO_OFFSET})`;
    const local = `CAST(REPLACE(REGEXP_REPLACE(${text}, ${ISO_OFFSET}, ''), 'T', ' ') AS DATETIME(3))`;
    const minutes = `IF(${offset} IS NULL OR ${offset} = 'Z', 0, IF(LEFT(${offset}, 1) = '-', -1, 1) * (CAST(SUBSTRING(${offset}, 2, 2) AS SIGNED) * 60 + CAST(SUBSTRING(${offset}, 5, 2) AS SIGNED)))`;
    return `TIMESTAMPADD(MINUTE, -(${minutes}), ${local})`;
  },
  integer: text => `CAST(${text} AS SIGNED)`,
  bigint: text => `CAST(${text} AS SIGNED)`,
  smallint: text => `CAST(${text} AS SIGNED)`,
  double: text => `CAST(${text} AS DOUBLE)`,
  real: text => `CAST(${text} AS DOUBLE)`,
  decimal: (text, _, target) => `CAST(${text} AS ${target.columnType})`,
};

const SQLITE: JsonDialect = {
  // The value as JSON text, so a string, a boolean or an object is set as itself.
  valueAt: (c, k) => `json(${c} -> ${dollarPath(k)})`,
  holds: (c, k) =>
    `json_type(${c}, ${dollarPath(k)}) IS NOT NULL AND json_type(${c}, ${dollarPath(k)}) <> 'null'`,
  hasKey: (c, k) => `json_type(${c}, ${dollarPath(k)}) IS NOT NULL`,
  set: (c, k, v) => `json_set(COALESCE(${c}, '{}'), ${dollarPath(k)}, ${v})`,
  remove: (c, k) => `json_remove(${c}, ${dollarPath(k)})`,
  emptyObject: "json('{}')",
  jsonNull: "json('null')",
  isObject: (c, k) => `json_type(${c}, ${dollarPath(k)}) = 'object'`,
  isEmptyObject: (c, k) =>
    `(json_type(${c}, ${dollarPath(k)}) = 'object' AND json_extract(${c}, ${dollarPath(k)}) = '{}')`,
  toJson: (c, target) => {
    switch (target.kind) {
      case "boolean":
        return `CASE WHEN ${c} THEN json('true') ELSE json('false') END`;
      case "timestamp":
        // The column holds seconds since the epoch.
        return `strftime('%Y-%m-%dT%H:%M:%fZ', ${c}, 'unixepoch')`;
      case "json":
        return `json(${c})`;
      default:
        return c;
    }
  },
  fromJson: (c, k, target) => {
    const value = `json_extract(${c}, ${dollarPath(k)})`;
    switch (target.kind) {
      case "timestamp":
        return `CAST(strftime('%s', ${value}) AS INTEGER)`;
      case "boolean":
        return `CASE WHEN ${value} IN (1, 'true') THEN 1 ELSE 0 END`;
      case "json":
        return `json(${c} -> ${dollarPath(k)})`;
      default:
        return value;
    }
  },
};

const DIALECTS: Record<SupportedDialect, JsonDialect> = {
  postgresql: POSTGRES,
  mysql: MYSQL,
  sqlite: SQLITE,
};

/**
 * The condition true for each entry whose group holds a value at `keys` of `column`, JSON null
 * not counted: the one the copy out of a group carries values on.
 */
export function holdsValueAt(
  column: string,
  keys: readonly string[],
  dialect: SupportedDialect
): string {
  return DIALECTS[dialect].holds(quoteIdent(column, dialect), keys);
}

/**
 * Each dialect's reading of the value at `keys`: the name of its JSON type (a string's is `string`
 * or `text`), and its text, a string unquoted.
 */
const HELD_VALUE: Record<
  SupportedDialect,
  (column: string, keys: readonly string[]) => { type: string; text: string }
> = {
  postgresql: (c, k) => ({
    type: `jsonb_typeof(${c} #> ${pgPath(k)})`,
    text: `${c} #>> ${pgPath(k)}`,
  }),
  mysql: (c, k) => ({
    type: `JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)}))`,
    text: `JSON_UNQUOTE(JSON_EXTRACT(${c}, ${dollarPath(k)}))`,
  }),
  sqlite: (c, k) => ({
    type: `json_type(${c}, ${dollarPath(k)})`,
    text: `json_extract(${c}, ${dollarPath(k)})`,
  }),
};

/**
 * The type and the text of the value each entry's group holds at `keys` of `column`, as select
 * expressions: what a check reads before a value is copied out of the group.
 */
export function heldValueAt(
  column: string,
  keys: readonly string[],
  dialect: SupportedDialect
): { type: string; text: string } {
  return HELD_VALUE[dialect](quoteIdent(column, dialect), keys);
}

/** An ISO date, alone or with a time and the offset it was written at. */
const ISO_DATE =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})(?:T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2})(?:\.(?<fraction>\d{1,3}))?)?(?:Z|(?<sign>[+-])(?<offsetHour>\d{2}):(?<offsetMinute>\d{2})))?$/;

/**
 * The instants MySQL's date column holds: it is a TIMESTAMP, which keeps 1970-01-01 00:00:01 to
 * 2038-01-19 03:14:07 UTC and refuses a value outside them, part-way through the file.
 */
const MYSQL_FIRST_INSTANT = Date.parse("1970-01-01T00:00:01Z");
const MYSQL_LAST_INSTANT = Date.parse("2038-01-19T03:14:07Z");

/**
 * Whether a date a group holds is copied into a date column as the same instant the entry reads:
 * an ISO date, or an ISO date and time with its offset, naming a day and time that exist. The
 * other forms an entry may hold read differently on each side: a time with no offset is read in
 * the server's zone by JavaScript and at UTC by the copy, a day past the month's end rolls into
 * the next month in JavaScript and is refused or read as nothing by a database, and a form such
 * as `July 17, 2026` is one SQLite cannot read at all. A move refuses those rather than guess.
 */
export function movesAsTheSameDate(
  value: string,
  dialect: SupportedDialect
): boolean {
  const written = ISO_DATE.exec(value)?.groups;
  if (written === undefined) return false;
  const at = (name: string) => Number(written[name] ?? 0);
  if (!dayExists(at("year"), at("month"), at("day"))) return false;
  // PostgreSQL's date input has no year 0: the year before 1 is written `0001 BC`.
  if (dialect === "postgresql" && at("year") === 0) return false;
  if (at("hour") > 23 || at("minute") > 59 || at("second") > 59) return false;
  // SQLite's date column keeps whole seconds, and so does MySQL's TIMESTAMP, which has no
  // fractional digits: the copy would drop or round the milliseconds.
  if (dialect !== "postgresql" && at("fraction") !== 0) return false;
  if (!offsetReadable(written.sign, at("offsetHour"), at("offsetMinute"))) {
    return false;
  }
  const instant = Date.parse(value);
  if (Number.isNaN(instant)) return false;
  if (dialect === "mysql") {
    return instant >= MYSQL_FIRST_INSTANT && instant <= MYSQL_LAST_INSTANT;
  }
  // PostgreSQL's and SQLite's date columns keep every year from 0 to 9999.
  const year = new Date(instant).getUTCFullYear();
  return year >= 0 && year <= 9999;
}

/** Whether a day is on the calendar: JavaScript would roll the 30th of February into March. */
function dayExists(year: number, month: number, day: number): boolean {
  const calendar = new Date(Date.UTC(2000, month - 1, day));
  calendar.setUTCFullYear(year);
  return (
    calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day
  );
}

/** Whether an offset is one a zone in use has, from -13:59 to +14:00, its minutes under 60. */
function offsetReadable(
  sign: string | undefined,
  hours: number,
  minutes: number
): boolean {
  if (sign === undefined) return true;
  const offset = (sign === "-" ? -1 : 1) * (hours * 60 + minutes);
  return minutes < 60 && offset >= -(13 * 60 + 59) && offset <= 14 * 60;
}

/**
 * Statements making each container above `keys` an object where an entry is about to get a value
 * there, keeping what one already holds: a key two levels down needs the group between.
 */
function containersFor(
  json: JsonDialect,
  table: string,
  column: string,
  keys: readonly string[],
  where: string
): string[] {
  return keys.slice(0, -1).map((_, at) => {
    const above = keys.slice(0, at + 1);
    return `UPDATE ${table} SET ${column} = ${json.set(column, above, json.emptyObject)} WHERE ${where} AND NOT (COALESCE(${json.isObject(column, above)}, FALSE));`;
  });
}

/**
 * What a key in a group becomes on an entry with no value to carry there. A column's empty value
 * is SQL NULL, which an entry reads as null, so the key holds JSON null: left out, it would read
 * as missing, which a default fills. From another group, a missing key stays missing. Either way
 * a key the group still holds from a field it once had does not show again as the moved field's.
 */
function emptyAtDestination(
  json: JsonDialect,
  table: string,
  from: StoragePlace,
  to: Extract<StoragePlace, { kind: "json" }>,
  holds: string,
  q: (name: string) => string
): string[] {
  const column = q(to.column);
  if (from.kind === "column") {
    const empty = `${q(from.column)} IS NULL`;
    return [
      ...containersFor(json, table, column, to.keys, empty),
      `UPDATE ${table} SET ${column} = ${json.set(column, to.keys, json.jsonNull)} WHERE ${empty};`,
    ];
  }
  return [
    // A group that is SQL NULL holds no key: its test answers NULL, read here as false.
    `UPDATE ${table} SET ${column} = ${json.remove(column, to.keys)} WHERE NOT (COALESCE(${holds}, FALSE)) AND ${json.hasKey(column, to.keys)};`,
  ];
}

/**
 * Statements that stop a run where an entry of the database the file runs on holds a value the
 * copy out of a group would not keep as it is: the save's own check (`keptValuesOf`) reads the
 * database the file is written from, and a deploy's may hold values that one never did. Each held
 * value is judged by the same rule, in SQL (`KEPT_TESTS`); a value that fails puts NULL into a
 * temporary table's NOT NULL column, so the run stops on that constraint, naming the field in the
 * table and column, before any statement has changed anything. The file places these first.
 *
 * On SQLite a date keeps its own names (`nextly_unreadable_date_` and the field's name), as released.
 */
function unkeptValuesStop(
  target: MoveColumn,
  table: string,
  from: Extract<StoragePlace, { kind: "json" }>,
  column: string
): string[] {
  const source = quoteIdent(from.column, target.dialect);
  const held = heldValueAt(from.column, from.keys, target.dialect);
  const holds = DIALECTS[target.dialect].holds(source, from.keys);
  if (target.dialect === "sqlite" && target.kind === "timestamp") {
    // SQLite's date stop keeps the names it was released with.
    return stopWhereNot(target.dialect, table, {
      guard: `nextly_unreadable_date_${column}`,
      reason: "an_entry_holds_a_date_sqlite_cannot_keep",
      kept: sqliteDateKept(held.text),
      where: holds,
    });
  }
  const kept = KEPT_TESTS[target.dialect](target, held);
  if (kept === undefined) return [];
  return stopWhereNot(target.dialect, table, {
    guard: `nextly_unkept_${column}`,
    reason: `cannot_keep_${column}`,
    kept,
    where: holds,
  });
}

/**
 * Statements that stop a run, before the file changes anything, where a date column moving into a
 * group holds a date the group's JSON could not keep as an ISO date: its copy writes four digits
 * of year, so a year past 9999 (or, on PostgreSQL, before the year 1) would be written as text
 * JavaScript does not read as a date on PostgreSQL, and as null on SQLite. MySQL's TIMESTAMP
 * holds no such year. The run stops on `cannot_keep_<field>`, naming the field.
 */
function unwritableDatesStop(
  target: MoveColumn,
  table: string,
  column: string
): string[] {
  if (target.kind !== "timestamp" || target.dialect === "mysql") return [];
  const value = quoteIdent(column, target.dialect);
  const kept =
    target.dialect === "postgresql"
      ? `extract(year from ${zoned(target.columnType) ? `${value} AT TIME ZONE 'UTC'` : value}) BETWEEN 1 AND 9999`
      : // SQLite's seconds from 0000-01-01T00:00:00Z to 9999-12-31T23:59:59Z, the dates it writes.
        `${value} BETWEEN -62167219200 AND 253402300799`;
  return stopWhereNot(target.dialect, table, {
    guard: `nextly_unkept_${column}`,
    reason: `cannot_keep_${column}`,
    kept,
    where: `${value} IS NOT NULL`,
  });
}

/**
 * Statements that stop a run, before the file changes anything, where an entry of the database it
 * runs on holds no value for a field that is required where it moves: the save's own check
 * (`refuseEmptyRequiredRefills`) reads the database the file is written from. The run stops on
 * `needs_a_value_<field>` in `nextly_unfilled_<field>`. A save that fills the column first has
 * no such entry left, and asks for none.
 */
export function missingValuesStop(
  target: MoveColumn,
  from: Extract<StoragePlace, { kind: "json" }>,
  column: string
): string[] {
  const source = quoteIdent(from.column, target.dialect);
  return stopWhereNot(
    target.dialect,
    quoteIdent(target.table, target.dialect),
    {
      guard: `nextly_unfilled_${column}`,
      reason: `needs_a_value_${column}`,
      kept: DIALECTS[target.dialect].holds(source, from.keys),
      // Every row: a row that holds nothing at the key is the one this stop is for.
      where: "1 = 1",
    }
  );
}

/**
 * One condition on the versions table as SQL. The table's columns are the snake case of the names
 * the versions repository queries them by, on every dialect (held by the drafts stop's tests). An
 * operator or a value this cannot write is refused, so no file is written with a condition left
 * out.
 */
function versionsConditionSql(
  condition: VersionsWhereCondition,
  dialect: SupportedDialect
): string {
  const column = quoteIdent(toSnakeCase(condition.column), dialect);
  if (condition.op === "IS NULL" || condition.op === "IS NOT NULL") {
    return `${column} ${condition.op}`;
  }
  const literal = conditionLiteral(condition.value, dialect);
  const operator = { "=": "=", "!=": "<>" }[condition.op as "=" | "!="];
  if (operator === undefined || literal === undefined) {
    throw NextlyError.internal({
      logContext: {
        reason: "working-draft-condition-unwritable",
        column: condition.column,
        op: condition.op,
      },
    });
  }
  return `${column} ${operator} ${literal}`;
}

/** A condition's value as an SQL literal: a boolean as the dialect keeps one, a plain string, a finite number. */
function conditionLiteral(
  value: VersionsWhereCondition["value"],
  dialect: SupportedDialect
): string | undefined {
  if (typeof value === "boolean") {
    if (dialect === "postgresql") return String(value);
    return value ? "1" : "0";
  }
  if (typeof value === "string") return `'${safeLiteral(value)}'`;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * Statements that stop a run, before the file changes anything, where a working draft of
 * `subject` holds the moved field at the place the run moves it away from (`at`): its old place
 * for the UP, its new one for the DOWN. The run rewrites each entry's row, not a draft's
 * snapshot, which keeps the field where it was, so publishing that draft would drop its pending
 * change. A draft holding a null at that place is held too, as is one whose group on the way to
 * it holds a null: either may be a pending clear. The
 * Schema Builder's save reads the database it writes from (`refuseMovesUnderWorkingDrafts`); a
 * file written offline asks the database it runs on. The run stops on
 * `publish_or_discard_drafts_of_<field>` in `nextly_drafted_<field>`, and goes ahead once those
 * drafts are published or discarded. It fails closed: a versions table or column the statement
 * cannot read is an error that stops the run as well.
 */
export function workingDraftsStop(
  dialect: SupportedDialect,
  subject: { kind: "collection" | "single"; slug: string },
  at: readonly string[]
): string[] {
  const name = at.map(safeKey).join("_");
  // The subject's working drafts, as the versions repository finds one (`WORKING_DRAFT_SHAPE`),
  // so the file and the application agree on which rows are working drafts.
  const working = [
    { column: "scopeKind", op: "=", value: subject.kind },
    { column: "scopeSlug", op: "=", value: subject.slug },
    ...WORKING_DRAFT_SHAPE,
  ] satisfies readonly VersionsWhereCondition[];
  return stopWhereNot(dialect, quoteIdent(VERSIONS_TABLE, dialect), {
    guard: `nextly_drafted_${name}`,
    reason: `publish_or_discard_drafts_of_${name}`,
    kept: `NOT (${draftHoldsPlace(dialect, at)})`,
    where: working
      .map(condition => versionsConditionSql(condition, dialect))
      .join(" AND "),
  });
}

/**
 * SQLite's rule for a date it keeps as the same instant: an ISO date, or one with a time and the
 * offset it was written at (a time with none is read at UTC here and in the server's zone by
 * the application), read at all (`strftime`), in whole seconds, on a day that exists (the date
 * part reads back as itself: `2026-02-30` would read as 2 March), at a time of day that exists
 * (hour to 23, minute and second to 59), as `movesAsTheSameDate` judges it before the save.
 * SQLite has no regular expressions, so the shape is its GLOB patterns.
 */
function sqliteDateKept(value: string): string {
  const date = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]";
  const shape = `(${value} GLOB '${date}' OR (${value} GLOB '${date}T[0-9][0-9]:[0-9][0-9]*' AND (${value} GLOB '*Z' OR ${value} GLOB '*[+-][0-9][0-9]:[0-9][0-9]')))`;
  const day = `substr(${value}, 1, 10)`;
  const time = `(length(${value}) = 10 OR (substr(${value}, 12, 2) <= '23' AND substr(${value}, 15, 2) <= '59' AND (substr(${value}, 17, 1) <> ':' OR substr(${value}, 18, 2) <= '59')))`;
  return `${shape} AND substr(strftime('%f', ${value}), 4) = '000' AND strftime('%s', ${value}) IS NOT NULL AND date(${day}) = ${day} AND ${time}`;
}

/**
 * A run's stop where some row matching `where` fails `kept` (a test that reads as NULL fails):
 * the first such row puts NULL into a temporary table's NOT NULL column, so the run stops on that
 * constraint, the table and column naming why. Only that one row is written, whatever the size
 * of the table, and none where every row passes. Their names are bounded as every derived identifier
 * is (`boundedIdentifier`): a long field keeps as much of its name as fits, then a hash of the
 * whole, within the 63 characters every dialect takes.
 */
function stopWhereNot(
  dialect: SupportedDialect,
  table: string,
  stop: { guard: string; reason: string; kept: string; where: string }
): string[] {
  return guardedStop(
    dialect,
    stop,
    `SELECT NULL FROM ${table} WHERE ${stop.where} AND (CASE WHEN ${stop.kept} THEN 0 ELSE 1 END) = 1 LIMIT 1`
  );
}

/** A run's stop where the query `rows` gives any row (`guardedStop`). */
function stopWhereAnyRow(
  dialect: SupportedDialect,
  stop: { guard: string; reason: string },
  rows: string
): string[] {
  const found = quoteIdent("found", dialect);
  return guardedStop(
    dialect,
    stop,
    `SELECT NULL FROM (${rows}) AS ${found} LIMIT 1`
  );
}

/**
 * The statements of one stop: a temporary table whose NOT NULL column `select`'s first row, a
 * NULL, is written into, so the run stops on that constraint, the table and column naming why.
 */
function guardedStop(
  dialect: SupportedDialect,
  stop: { guard: string; reason: string },
  select: string
): string[] {
  const q = (name: string) => quoteIdent(boundedIdentifier(name), dialect);
  // Unqualified: SQLite and PostgreSQL look a name up among temporary tables first, and the
  // migration's deletion check reads a table the file creates as temporary as the file's own.
  const guard = q(stop.guard);
  const reason = q(stop.reason);
  const temporary = dialect === "mysql" ? "TEMPORARY" : "TEMP";
  return [
    `CREATE ${temporary} TABLE ${guard} (${reason} INTEGER NOT NULL);`,
    `INSERT INTO ${guard} (${reason}) ${select};`,
    dialect === "mysql"
      ? `DROP TEMPORARY TABLE ${guard};`
      : `DROP TABLE ${guard};`,
  ];
}

/**
 * Each value the key `keys` of `column` holds in more than one entry of `table`, as a query: what
 * a field moved out of the group into a unique column would repeat there. An entry holding no
 * value, or JSON null, repeats nothing, as a unique index leaves NULL free on every dialect. Values
 * are compared by their text, so the number 1 and the string "1" count as one value, as the column
 * would hold them. The save counts these rows before it writes anything; the file stops over the
 * first (`repeatedValuesStop`).
 */
export function repeatedValuesAt(
  table: string,
  from: Extract<StoragePlace, { kind: "json" }>,
  dialect: SupportedDialect
): string {
  const value = heldValueAt(from.column, from.keys, dialect).text;
  return `SELECT ${value} AS ${quoteIdent("value", dialect)} FROM ${quoteIdent(table, dialect)} WHERE ${holdsValueAt(from.column, from.keys, dialect)} GROUP BY ${value} HAVING COUNT(*) > 1`;
}

/**
 * Statements that stop a run, before the file changes anything, where two entries of the database
 * it runs on hold one value for a field moved out of a group into a unique column: the save's own
 * count (`repeatedValuesAt`) reads the database the file is written from, and a deploy's may
 * repeat a value that one never did. The run stops on `two_entries_hold_one_<field>` in
 * `nextly_repeated_<field>`.
 */
export function repeatedValuesStop(
  target: MoveColumn,
  from: Extract<StoragePlace, { kind: "json" }>,
  column: string
): string[] {
  return stopWhereAnyRow(
    target.dialect,
    {
      guard: `nextly_repeated_${column}`,
      reason: `two_entries_hold_one_${column}`,
    },
    repeatedValuesAt(target.table, from, target.dialect)
  );
}

/**
 * An ISO date, alone or with a time and the offset it was written at (`ISO_DATE`, as the save's
 * check reads it), in the regular expressions PostgreSQL and MySQL share.
 */
const SQL_ISO_DATE =
  "'^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}(:[0-9]{2}([.][0-9]{1,3})?)?(Z|[+-][0-9]{2}:[0-9]{2}))?$'";

/**
 * PostgreSQL's rule for a date it keeps as the same instant, as `movesAsTheSameDate` judges it:
 * an ISO date, or one with a time and its offset (a time with none would be read in the session's
 * zone); a year other than 0, a month and day that exist, a time of day that exists, and an
 * offset from -13:59 to +14:00. Each step guards the next, since a cast of a day that does not
 * exist is an error rather than an answer.
 */
function pgDateKept(text: string): string {
  const part = (from: number, length: number) =>
    `substr(${text}, ${from}, ${length})`;
  const lastDay = `extract(day from (date_trunc('month', (${part(1, 7)} || '-01')::date) + interval '1 month' - interval '1 day'))`;
  const time = `(length(${text}) = 10 OR (${part(12, 2)} <= '23' AND ${part(15, 2)} <= '59' AND (${part(17, 1)} <> ':' OR ${part(18, 2)} <= '59')))`;
  const offset = `right(${text}, 6)`;
  const offsetKept = `(length(${text}) = 10 OR right(${text}, 1) = 'Z' OR (substr(${offset}, 5, 2) <= '59' AND ((left(${offset}, 1) = '+' AND substr(${offset}, 2, 5) <= '14:00') OR (left(${offset}, 1) = '-' AND substr(${offset}, 2, 5) <= '13:59'))))`;
  return `(CASE WHEN ${text} ~ ${SQL_ISO_DATE} AND ${part(1, 4)} <> '0000' AND ${part(6, 2)} BETWEEN '01' AND '12' THEN ${part(9, 2)} >= '01' AND ${part(9, 2)}::int <= ${lastDay} AND ${time} AND ${offsetKept} ELSE FALSE END)`;
}

/** A JSON number's text, as each dialect's cast reads it; no backslash, so one spelling fits all. */
const SQL_JSON_NUMBER = "'^-?[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$'";
const SQL_WHOLE_NUMBER = "'^-?[0-9]{1,10}$'";

/**
 * Each dialect's rule, in SQL, for whether the copy keeps a held value as it is: the same rules
 * the save checks first (`keptValuesOf` in `kept-values.ts`), for the kinds whose cast would
 * round, cut, clamp or misread a value there. Undefined where the copy keeps every value.
 */
const KEPT_TESTS: Record<
  SupportedDialect,
  (
    target: MoveColumn,
    held: { type: string; text: string }
  ) => string | undefined
> = {
  postgresql: (target, { type, text }) => {
    const numeric = `(${text})::numeric`;
    switch (target.kind) {
      case "integer":
        return `(CASE WHEN ${text} ~ ${SQL_WHOLE_NUMBER} THEN (${text})::bigint BETWEEN -2147483648 AND 2147483647 ELSE FALSE END)`;
      case "double":
        return `(${text} ~ ${SQL_JSON_NUMBER})`;
      case "decimal":
        return target.precision === undefined || target.scale === undefined
          ? undefined
          : `(CASE WHEN ${text} ~ ${SQL_JSON_NUMBER} THEN ${numeric} = round(${numeric}, ${target.scale}) AND abs(${numeric}) < power(10::numeric, ${target.precision - target.scale}) ELSE FALSE END)`;
      case "boolean":
        return `(${type} = 'boolean' OR (${type} = 'number' AND ${text} IN ('0', '1')) OR (${type} = 'string' AND ${text} IN ('true', 'false')))`;
      case "timestamp":
        return `(${type} = 'string' AND ${pgDateKept(text)})`;
      default:
        return widthTest(target, `char_length(${text})`, undefined);
    }
  },
  mysql: (target, { type, text }) => {
    const decimal = `CAST(${text} AS DECIMAL(65, 30))`;
    // Compared byte for byte, as the save's check does: MySQL's own collation would match `True`.
    const exact = `${text} COLLATE utf8mb4_bin`;
    switch (target.kind) {
      case "integer":
        return `(CASE WHEN ${text} REGEXP ${SQL_WHOLE_NUMBER} THEN CAST(${text} AS SIGNED) BETWEEN -2147483648 AND 2147483647 ELSE FALSE END)`;
      case "double":
        return `(${text} REGEXP ${SQL_JSON_NUMBER})`;
      case "decimal":
        return target.precision === undefined || target.scale === undefined
          ? undefined
          : `(CASE WHEN ${text} REGEXP ${SQL_JSON_NUMBER} THEN ${decimal} = ROUND(${decimal}, ${target.scale}) AND ABS(${decimal}) < POW(10, ${target.precision - target.scale}) ELSE FALSE END)`;
      case "boolean":
        return `(${type} = 'BOOLEAN' OR (${type} = 'INTEGER' AND ${text} IN ('0', '1')) OR (${type} = 'STRING' AND ${exact} IN ('true', 'false')))`;
      case "timestamp": {
        // An ISO date, or one with a time and its offset; whole seconds, at an instant its
        // TIMESTAMP holds. A day or time that does not exist reads as NULL, which stops it too.
        const instant = MYSQL_READS.timestamp?.(text, text, target) ?? text;
        // Each step guards the next: in strict mode a cast of a day that does not exist is an
        // error, not a NULL, so the calendar is judged before the date is read.
        const part = (from: number, length: number) =>
          `SUBSTRING(${text}, ${from}, ${length})`;
        const day = `(${part(9, 2)} >= '01' AND CAST(${part(9, 2)} AS UNSIGNED) <= DAY(LAST_DAY(CONCAT(${part(1, 7)}, '-01'))))`;
        const time = `(CHAR_LENGTH(${text}) = 10 OR (${part(12, 2)} <= '23' AND ${part(15, 2)} <= '59' AND (${part(17, 1)} <> ':' OR ${part(18, 2)} <= '59')))`;
        return `(CASE WHEN NOT (${text} REGEXP ${SQL_ISO_DATE}) OR ${text} REGEXP '[.][0-9]*[1-9]' THEN FALSE WHEN NOT (${part(6, 2)} BETWEEN '01' AND '12' AND ${part(1, 4)} BETWEEN '1969' AND '2038') THEN FALSE WHEN NOT (${day} AND ${time}) THEN FALSE ELSE ${instant} BETWEEN '1970-01-01 00:00:01' AND '2038-01-19 03:14:07' END)`;
      }
      default:
        return widthTest(target, `CHAR_LENGTH(${text})`, `LENGTH(${text})`);
    }
  },
  sqlite: (target, { type, text }) =>
    // SQLite stores a number or a text as it is; only a checkbox's value is read as another.
    target.kind === "boolean"
      ? `(${type} IN ('true', 'false') OR (${type} = 'integer' AND ${text} IN (0, 1)) OR (${type} = 'text' AND ${text} IN ('true', 'false')))`
      : undefined,
};

/**
 * Whether a string column of a bounded width keeps a held value: a `varchar(N)`'s characters, or
 * (with `bytes`, MySQL's `text`) its 65 535 bytes. Undefined for a column of any width.
 */
function widthTest(
  target: MoveColumn,
  characters: string,
  bytes: string | undefined
): string | undefined {
  const width = /^(?:varchar|char)\((\d+)\)$/i.exec(target.columnType)?.[1];
  if (width !== undefined) return `(${characters} <= ${width})`;
  if (bytes !== undefined && target.columnType.toLowerCase() === "text") {
    return STRING_COLUMN_KINDS.has(target.kind)
      ? `(${bytes} <= 65535)`
      : undefined;
  }
  return undefined;
}

/** The kinds stored as a string, whose column may bound its width. */
const STRING_COLUMN_KINDS: ReadonlySet<ColumnKind> = new Set<ColumnKind>([
  "text",
  "longText",
  "shortText",
  "varchar",
  "char",
  "fkSingle",
]);

/**
 * Statements putting a group back as it was where a move into it is undone: the way in sets the
 * key on every entry (JSON null where there was no value) and makes each container above it an
 * object, so once the way back clears the key, each container left with no keys is removed,
 * deepest first, and a group left with none is NULL again, as an entry with no group value holds
 * it. A container that held keys keeps them, so only what nothing else needs goes. A required
 * group's column (`nullable` false) cannot be NULL and keeps its empty object.
 */
export function emptiedContainers(
  place: Extract<StoragePlace, { kind: "json" }>,
  target: MoveColumn,
  nullable: boolean
): string[] {
  const json = DIALECTS[target.dialect];
  const table = quoteIdent(target.table, target.dialect);
  const column = quoteIdent(place.column, target.dialect);
  const statements: string[] = [];
  for (let depth = place.keys.length - 1; depth >= 1; depth--) {
    const above = place.keys.slice(0, depth);
    statements.push(
      `UPDATE ${table} SET ${column} = ${json.remove(column, above)} WHERE ${json.isEmptyObject(column, above)};`
    );
  }
  if (nullable) {
    statements.push(
      `UPDATE ${table} SET ${column} = NULL WHERE ${json.isEmptyObject(column, [])};`
    );
  }
  return statements;
}

/**
 * Whether a working draft's snapshot holds the place `at`: its key, a null included, or a group on
 * the way to it cleared to null, which clears the field with it.
 */
function draftHoldsPlace(
  dialect: SupportedDialect,
  at: readonly string[]
): string {
  const json = DIALECTS[dialect];
  const snapshot = quoteIdent("snapshot", dialect);
  const clearedAbove = at
    .slice(0, -1)
    .map((_, i) => at.slice(0, i + 1))
    .map(
      above =>
        `(${json.hasKey(snapshot, above)} AND NOT (${json.holds(snapshot, above)}))`
    );
  return [json.hasKey(snapshot, at), ...clearedAbove].join(" OR ");
}

/**
 * The statement moving the media library's record of where an item is used along with a moved
 * field: each use recorded at `from` (the field's names joined by dots, as the record keeps a
 * path) or under it is recorded at `to` instead, for the entries of `subject`. Left at the old
 * path, a use would still name its item, so the item would go on reading as used (every reader of
 * whether an item is used keys on its id, never the path): only "Used in" would name the old path,
 * until the entry is saved again, which records its uses afresh from the content, or
 * `nextly media reindex-usage` rebuilds the record. A use already recorded at the new path for the
 * same entry, item and language (a row left by a field once there) keeps that row, and the one at
 * the old path stays until such a save or rebuild, so the unique key is never broken.
 */
export function mediaUsePathStatement(
  dialect: SupportedDialect,
  subject: { kind: "collection" | "single"; slug: string },
  from: readonly string[],
  to: readonly string[]
): string {
  const q = (name: string) => quoteIdent(name, dialect);
  const literal = (text: string) => `'${safeLiteral(text)}'`;
  const oldPath = from.map(safeKey).join(".");
  const newPath = to.map(safeKey).join(".");
  const table = q(MEDIA_USAGE_TABLE);
  // The path a row takes: the new one for the field itself, or the new one before the rest of a
  // path under it. Every key is a plain name (`safeKey`), so characters and bytes count alike.
  const rest = (path: string) => `SUBSTR(${path}, ${oldPath.length + 1})`;
  const moved = (path: string) =>
    dialect === "mysql"
      ? `CONCAT(${literal(newPath)}, ${rest(path)})`
      : `(${literal(newPath)} || ${rest(path)})`;
  const field = q("field_path");
  const under = (path: string) =>
    `(${path} = ${literal(oldPath)} OR SUBSTR(${path}, 1, ${oldPath.length + 1}) = ${literal(`${oldPath}.`)})`;
  const same = (column: string) =>
    `${q("taken")}.${q(column)} = ${table}.${q(column)}`;
  // Read through a derived table, which MySQL lets an UPDATE read its own table by.
  return `UPDATE ${table} SET ${field} = ${moved(field)} WHERE ${q("subject_kind")} = ${literal(subject.kind)} AND ${q("subject_slug")} = ${literal(subject.slug)} AND ${under(field)} AND NOT EXISTS (SELECT 1 FROM (SELECT ${q("subject_kind")}, ${q("subject_slug")}, ${q("document_id")}, ${q("locale")}, ${q("media_id")}, ${q("field_path")} FROM ${table} WHERE ${q("subject_kind")} = ${literal(subject.kind)} AND ${q("subject_slug")} = ${literal(subject.slug)}) AS ${q("taken")} WHERE ${same("subject_kind")} AND ${same("subject_slug")} AND ${same("document_id")} AND ${same("locale")} AND ${same("media_id")} AND ${q("taken")}.${field} = ${moved(`${table}.${field}`)});`;
}

/** Text written as an SQL string literal: refused where it would need more than plain characters. */
function safeLiteral(text: string): string {
  if (!/^[A-Za-z0-9_.$-]+$/.test(text)) {
    throw new NextlyError({
      code: "VALIDATION_ERROR",
      publicMessage: "A moved field's entity cannot be named in its migration.",
      logContext: { text },
    });
  }
  return text;
}

/**
 * The data statements moving a field's values from `move.from` to `move.to` on `target`'s table:
 * a column into a key of a group's JSON, a key back out to a column, or a key from one group to
 * another.
 */
export function moveDataStatements(
  move: { from: StoragePlace; to: StoragePlace },
  target: MoveColumn
): MoveDataStatements {
  const json = DIALECTS[target.dialect];
  const q = (name: string) => quoteIdent(name, target.dialect);
  const table = q(target.table);
  const { from, to } = move;

  // Where an entry holds a value to carry, and that value in the form `to` takes. Between two
  // groups an explicit JSON null is a value too, and is carried as null: a missing key and a null
  // one read differently, since a default fills only the missing one.
  const source =
    from.kind === "column"
      ? {
          holds: `${q(from.column)} IS NOT NULL`,
          asJson: json.toJson(q(from.column), target),
        }
      : {
          holds:
            to.kind === "json"
              ? json.hasKey(q(from.column), from.keys)
              : json.holds(q(from.column), from.keys),
          asJson: json.valueAt(q(from.column), from.keys),
        };

  const stop =
    to.kind === "column" && from.kind === "json"
      ? unkeptValuesStop(target, table, from, to.column)
      : from.kind === "column" && to.kind === "json"
        ? unwritableDatesStop(target, table, from.column)
        : [];
  const copy =
    to.kind === "column"
      ? [
          `UPDATE ${table} SET ${q(to.column)} = ${
            from.kind === "json"
              ? json.fromJson(q(from.column), from.keys, target)
              : q(from.column)
          } WHERE ${source.holds};`,
          // An explicit JSON null arrives as NULL: a column added or put back with a database
          // default would otherwise keep that default where the entry said nothing.
          ...(from.kind === "json"
            ? [
                `UPDATE ${table} SET ${q(to.column)} = NULL WHERE ${json.hasKey(q(from.column), from.keys)} AND NOT (${source.holds});`,
              ]
            : []),
        ]
      : [
          ...emptyAtDestination(json, table, from, to, source.holds, q),
          ...containersFor(json, table, q(to.column), to.keys, source.holds),
          `UPDATE ${table} SET ${q(to.column)} = ${json.set(q(to.column), to.keys, source.asJson)} WHERE ${source.holds};`,
        ];

  // A key is cleared only where its value arrived: a value the copy could not read into the
  // column (a date in a form the database does not parse, say) stays where it was, never lost.
  const arrived =
    to.kind === "column"
      ? `(${q(to.column)} IS NOT NULL OR NOT (${source.holds}))`
      : json.hasKey(q(to.column), to.keys);
  const clearSource =
    from.kind === "json"
      ? [
          `UPDATE ${table} SET ${q(from.column)} = ${json.remove(q(from.column), from.keys)} WHERE ${json.hasKey(q(from.column), from.keys)} AND ${arrived};`,
        ]
      : [];

  return { stop, copy, clearSource };
}
