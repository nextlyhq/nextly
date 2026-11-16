/**
 * The value a NOT NULL column is backfilled with when it is added to a table
 * that already has rows.
 *
 * One function for the collection and field-group alter paths, which both add
 * such columns: the empty value per field type and dialect is one decision,
 * and two copies of it drift.
 *
 * @module domains/schema/utils/backfill-default
 */
import {
  pluginEmptyColumnDefault,
  pluginEmptyValue,
  storageTypeToken,
} from "../../../shared/lib/plugin-storage";
import type { SupportedDialect } from "../../../types/database";

import { quoteExpressionSqlDefault } from "./sql-literal";

export interface BackfillDefaultArgs {
  /** The field type, or the storage primitive it resolved to. */
  type: string;
  /** The field as DECLARED, so a contributed type can state its own empty. */
  field: { type?: unknown } | undefined;
  dialect: SupportedDialect;
  /** The caller's own literal renderer for a scalar in a storage type. */
  formatDefaultValue: (value: unknown, storageToken: string) => string;
  /**
   * Field types the caller stores in a JSON array column, backfilled with
   * `[]`. Differs per caller because the column a type maps to does: the
   * collection path stores `chips` as a JSON array, the field-group path as
   * text, where `''` is the empty.
   */
  jsonArrayTypes?: ReadonlySet<string>;
}

/**
 * What a backfilled column of this field type is filled with, before it is written for a caller:
 * the one decision both renderings below take, so the SQL default a file writes and the value an
 * apply binds cannot come to fill a column differently.
 */
type BackfillEmpty =
  | { kind: "contributed"; value: unknown; json: boolean }
  | { kind: "json"; text: string }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "now" }
  | { kind: "none" }
  | { kind: "text" };

function backfillEmptyFor(
  args: Pick<BackfillDefaultArgs, "type" | "field" | "jsonArrayTypes">
): BackfillEmpty {
  const { type } = args;
  // A contributed type states its own backfill before the primitive's is
  // derived: `{}` satisfies a json column and then fails every read that
  // expects the structure the type actually stores. Read from the field as
  // DECLARED — `type` here may already be the storage primitive, under which
  // the contributed type is not registered and states nothing.
  const field = args.field ?? { type };
  const contributed = pluginEmptyValue(field);
  if (contributed !== undefined) {
    return {
      kind: "contributed",
      value: contributed,
      json: (storageTypeToken(field) ?? type) === "json",
    };
  }
  if (args.jsonArrayTypes?.has(type) === true) {
    return { kind: "json", text: "[]" };
  }
  switch (type) {
    case "number":
      return { kind: "number" };
    case "checkbox":
      return { kind: "boolean" };
    case "date":
      return { kind: "now" };
    case "json":
    case "repeater":
    case "group":
      // These share the blocks column type, so they share its restriction on
      // how a default may be written.
      return { kind: "json", text: "{}" };
    case "relationship":
    case "upload":
      // Relations are nullable by nature when adding to existing tables.
      return { kind: "none" };
    default:
      // Every text-backed type — text, textarea, email, password, richText,
      // code, select, radio — and anything unrecognised.
      return { kind: "text" };
  }
}

/** The SQL default expression a backfilled column of this field type gets. */
export function backfillDefaultForType(args: BackfillDefaultArgs): string {
  const { type, dialect } = args;
  const empty = backfillEmptyFor(args);
  switch (empty.kind) {
    case "contributed":
      return (
        pluginEmptyColumnDefault(args.field ?? { type }, type, {
          json: serialized => quoteExpressionSqlDefault(serialized, dialect),
          literal: (value, storageToken) =>
            args.formatDefaultValue(value, storageToken),
        }) ?? "NULL"
      );
    case "json":
      return quoteExpressionSqlDefault(empty.text, dialect);
    case "number":
      return "0";
    case "boolean":
      return dialect === "sqlite" ? "0" : "FALSE";
    case "now":
      return dialect === "sqlite"
        ? String(Math.floor(Date.now() / 1000))
        : "NOW()";
    case "none":
      return "NULL";
    case "text":
      return "''";
  }
}

/**
 * A date as a fill stores it, the one form both the push binds and a migration
 * file writes, so the two land on the same value: the UTC ISO string on
 * PostgreSQL, as every date Nextly writes is sent (its `timestamp` column has
 * no time zone, so a bound `Date` would land as the process's local time); the
 * UTC `YYYY-MM-DD HH:MM:SS.fff` on MySQL, whose session is pinned to UTC and
 * whose datetime refuses the ISO form's `T` and `Z`; on SQLite, which stores a
 * date as an integer, its epoch seconds.
 */
/**
 * The shape of MySQL's stored form of a date fill (`storedDateValue`), a UTC
 * `YYYY-MM-DD HH:MM:SS` with up to six digits of fraction: what a check of a
 * date fill accepts on MySQL beside the ISO form and a `Date`.
 */
const MYSQL_STORED_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

/**
 * Whether `value` is a date in MySQL's stored form (`MYSQL_STORED_DATE`) that
 * exists: read as UTC, it comes back as written, so a month, day, hour or
 * minute out of range, which `Date` would roll into the next one, is refused.
 */
export function isMysqlStoredDate(value: string): boolean {
  if (!MYSQL_STORED_DATE.test(value)) return false;
  const at = new Date(`${value.replace(" ", "T")}Z`);
  return (
    !Number.isNaN(at.getTime()) &&
    at.toISOString().slice(0, 19) === value.slice(0, 19).replace(" ", "T")
  );
}

export function storedDateValue(
  date: Date,
  dialect: SupportedDialect
): string | number {
  if (dialect === "sqlite") return Math.floor(date.getTime() / 1000);
  const iso = date.toISOString();
  return dialect === "mysql" ? iso.slice(0, 23).replace("T", " ") : iso;
}

/**
 * The value a backfilled column of this field type is filled with, for an apply that binds it as
 * a parameter rather than writing it into the column's definition, such as the schema pipeline's
 * fill of a Required column added to a table that holds rows. The same empty
 * `backfillDefaultForType` writes as SQL, in the form each dialect's driver binds: SQLite takes
 * neither a boolean nor a date, so they are its 0 and its epoch seconds; a JSON column takes its
 * JSON text. `undefined` where nothing satisfies NOT NULL: a relationship's every id would name a
 * row that is not there.
 */
export function backfillValueForType(
  args: Pick<
    BackfillDefaultArgs,
    "type" | "field" | "jsonArrayTypes" | "dialect"
  >,
  now: Date
): unknown {
  const empty = backfillEmptyFor(args);
  const sqlite = args.dialect === "sqlite";
  switch (empty.kind) {
    case "contributed":
      if (empty.json) return JSON.stringify(empty.value);
      if (empty.value instanceof Date) {
        return storedDateValue(empty.value, args.dialect);
      }
      return sqlite && typeof empty.value === "boolean"
        ? Number(empty.value)
        : empty.value;
    case "json":
      return empty.text;
    case "number":
      return 0;
    case "boolean":
      return sqlite ? 0 : false;
    case "now":
      return storedDateValue(now, args.dialect);
    case "none":
      return undefined;
    case "text":
      return "";
  }
}
