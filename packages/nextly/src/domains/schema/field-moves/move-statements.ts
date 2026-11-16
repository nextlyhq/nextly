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
import { quoteIdent } from "../pipeline/sql-templates/identifier-quoting";
import type { ColumnKind } from "../services/field-column-descriptor";

import type { StoragePlace } from "./check-move";

/** The table a move runs on, and the moved field's column: its kind and its type there. */
export interface MoveColumn {
  table: string;
  dialect: SupportedDialect;
  kind: ColumnKind;
  /** The column's SQL type, which a value read out of JSON is cast to. */
  columnType: string;
}

export interface MoveDataStatements {
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
  /** Whether the value at `keys` is an object, so a key can be set inside it. */
  isObject(column: string, keys: readonly string[]): string;
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
  isObject: (c, k) => `jsonb_typeof(${c} #> ${pgPath(k)}) = 'object'`,
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
      return zoned(target.columnType)
        ? `(${text})::timestamptz`
        : `((${text})::timestamptz AT TIME ZONE 'UTC')`;
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
  isObject: (c, k) =>
    `JSON_TYPE(JSON_EXTRACT(${c}, ${dollarPath(k)})) = 'OBJECT'`,
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
    // The column holds UTC: the local part is read, then moved from its offset to UTC.
    const offset = `REGEXP_SUBSTR(${text}, ${ISO_OFFSET})`;
    const local = `CAST(REPLACE(REGEXP_REPLACE(${text}, ${ISO_OFFSET}, ''), 'T', ' ') AS DATETIME(3))`;
    return `CONVERT_TZ(${local}, IF(${offset} IS NULL OR ${offset} = 'Z', '+00:00', ${offset}), '+00:00')`;
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
  isObject: (c, k) => `json_type(${c}, ${dollarPath(k)}) = 'object'`,
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

  const copy =
    to.kind === "column"
      ? [
          `UPDATE ${table} SET ${q(to.column)} = ${
            from.kind === "json"
              ? json.fromJson(q(from.column), from.keys, target)
              : q(from.column)
          } WHERE ${source.holds};`,
        ]
      : [
          // A key the group still holds from a field it once had, on an entry with nothing to
          // carry: cleared, so it does not show again as the moved field's value.
          `UPDATE ${table} SET ${q(to.column)} = ${json.remove(q(to.column), to.keys)} WHERE NOT (${source.holds}) AND ${json.hasKey(q(to.column), to.keys)};`,
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

  return { copy, clearSource };
}
