/**
 * Translate a stored filter into a Drizzle condition.
 *
 * Extracted from the collection read path so every caller that has to honour a
 * filter — a caller's own `where`, a stored access constraint on a read, the
 * same constraint when a relationship populates a row from that collection —
 * compiles it through one implementation. A second translator would be free to
 * disagree with this one about an operator, and a filter that binds less than
 * the rule states is how a read widens without anyone noticing.
 *
 * Localized fields live in a companion table and cannot be resolved from the
 * main schema, so a caller that supports them supplies the builder that emits
 * the companion EXISTS. A caller that does not pass one leaves such a field
 * unresolved, which its own untranslatable check is expected to catch before
 * this point rather than silently dropping the predicate.
 */
import { caseInsensitiveContains } from "@nextlyhq/adapter-drizzle/text-match";
import type { SQL } from "drizzle-orm";
import {
  and,
  Column,
  eq,
  is,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  like,
  isNull,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import { SQLiteTimestamp } from "drizzle-orm/sqlite-core";

import type { LocalizedFieldRef } from "../../domains/i18n/companion-join";
import { buildCompanionExists } from "../../domains/i18n/companion-join";
import { NextlyError } from "../../errors/nextly-error";
import { toSnakeCase } from "../../shared/lib/case-conversion";
import { readIsoDateOrInstant } from "../../shared/lib/iso-instant";

import type { buildWhereClause } from "./query-operators";

/**
 * Localized-query context (i18n M4c) threaded into the search/where builders so a localized
 * field filters via a companion EXISTS on the requested locale instead of being silently
 * dropped. `null`/absent → non-localized behavior (unchanged).
 */
export interface LocalizedQueryContext {
  companionTableName: string;
  /** Localized fields with both the camelCase name (matching) and snake_case column (SQL). */
  localizedFields: LocalizedFieldRef[];
  /** The main table's `id` column (Drizzle) — the companion `_parent` correlation target. */
  mainIdColumn: unknown;
  /** The locale to filter on (the requested locale — chain head). */
  locale: string;
  /**
   * Per-locale status filter (i18n M6). Set (e.g. `"published"`) when the read resolves to a
   * single status and the collection has per-locale status, so localized where/search EXISTS
   * checks only match companion rows in that state. Undefined = no status constraint.
   */
  statusValues?: readonly string[];
}

/** Emits the companion-table EXISTS for a filter on a localized field. */
export type LocalizedExistsBuilder = (
  localizedCtx: LocalizedQueryContext,
  column: string,
  op: string,
  value: unknown
) => SQL | undefined;

/**
 * Translate a filter on a localized field into a companion-table EXISTS.
 *
 * Sits beside the condition builder it feeds for the same reason that one is
 * shared: a localized field is filtered by a subquery rather than a column, so
 * a second implementation of this mapping would be free to disagree about an
 * operator — and here the disagreement is invisible, because a filter that
 * matches the wrong companion rows still returns a plausible result set.
 *
 * Returns `undefined` for an operator with no companion equivalent, leaving the
 * caller to treat the filter as untranslated rather than as unrestricted.
 */
export function buildLocalizedWhereExists(
  ctx: LocalizedQueryContext,
  column: string,
  op: string,
  value: unknown
): SQL | undefined {
  const t = sql.identifier(ctx.companionTableName);
  const col = sql.identifier(column);
  let valueCondition: SQL | undefined;
  switch (op) {
    case "=":
      valueCondition = sql`${t}.${col} = ${value}`;
      break;
    case "!=":
      valueCondition = sql`${t}.${col} <> ${value}`;
      break;
    case ">":
      valueCondition = sql`${t}.${col} > ${value}`;
      break;
    case ">=":
      valueCondition = sql`${t}.${col} >= ${value}`;
      break;
    case "<":
      valueCondition = sql`${t}.${col} < ${value}`;
      break;
    case "<=":
      valueCondition = sql`${t}.${col} <= ${value}`;
      break;
    case "LIKE":
      valueCondition = sql`${t}.${col} LIKE ${value}`;
      break;
    case "ILIKE":
      // Lower-cased on both sides, as the adapter compiles ILIKE: only PostgreSQL has the
      // keyword, and a bare LIKE follows the column's collation.
      valueCondition = sql`lower(${t}.${col}) like lower(${value})`;
      break;
    case "ICONTAINS":
      valueCondition = caseInsensitiveContains(sql`${t}.${col}`, String(value));
      break;
    case "IS NULL": {
      // A localized field is absent for the locale when no companion row holds
      // a value — an untranslated entry usually has no companion row at all.
      // Match those with NOT EXISTS(row with a value) rather than
      // EXISTS(col IS NULL), which would require a companion row to exist.
      const present = buildCompanionExists({
        companionTableName: ctx.companionTableName,
        mainIdColumn: ctx.mainIdColumn,
        locale: ctx.locale,
        valueCondition: sql`${t}.${col} IS NOT NULL`,
        statusValues: ctx.statusValues,
      });
      return sql`NOT ${present}`;
    }
    case "IS NOT NULL":
      valueCondition = sql`${t}.${col} IS NOT NULL`;
      break;
    case "IN":
      if (Array.isArray(value) && value.length > 0) {
        // Expand the array into an SQL list; a bare array bind would emit
        // `col IN $1` and compare against the whole array as one value.
        const inList = sql.join(
          value.map(v => sql`${v}`),
          sql`, `
        );
        valueCondition = sql`${t}.${col} IN (${inList})`;
      }
      break;
    case "NOT IN":
      if (Array.isArray(value) && value.length > 0) {
        // Expand into an SQL list, mirroring the IN case; without this the
        // localized not_in filter is silently dropped and excludes nothing.
        const notInList = sql.join(
          value.map(v => sql`${v}`),
          sql`, `
        );
        valueCondition = sql`${t}.${col} NOT IN (${notInList})`;
      } else if (Array.isArray(value)) {
        // An empty list excludes nothing, whatever the companion holds.
        return sql`1 = 1`;
      }
      break;
    default:
      return undefined;
  }
  if (!valueCondition) return undefined;
  return buildCompanionExists({
    companionTableName: ctx.companionTableName,
    mainIdColumn: ctx.mainIdColumn,
    locale: ctx.locale,
    valueCondition,
    statusValues: ctx.statusValues,
  });
}

/**
 * Refuse a filter key this builder cannot turn into a predicate.
 *
 * Thrown rather than skipped: a skipped member leaves its siblings to decide
 * alone, which matches more rows than the filter states.
 */
function refuseKey(column: string, code: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path: `where.${column}`, code, message }],
  });
}

/**
 * The column a filter key names on this table, or a refusal.
 *
 * Read as an OWN property holding a Drizzle column. A plain property read
 * also reaches the table object's prototype, so `constructor` or `getSQL`
 * would resolve to something that is not a column and compile into a
 * predicate nobody wrote.
 */
function resolveColumn(schema: object, column: string): Column {
  // The name as written first, then its snake_case form: a runtime table keys
  // its system timestamps `created_at`, while every response spells them
  // `createdAt`, and a filter written the way rows read must reach them.
  for (const key of [column, toSnakeCase(column)]) {
    const candidate: unknown = Object.prototype.hasOwnProperty.call(schema, key)
      ? (schema as Record<string, unknown>)[key]
      : undefined;
    if (is(candidate, Column)) return candidate;
  }
  return refuseKey(
    column,
    "FILTER_UNKNOWN_FIELD",
    `"${column}" is not a field this collection can be filtered on.`
  );
}

/** The operators that compare a column with a value of the column's own kind. */
const COMPARISONS = new Set(["=", "!=", ">", ">=", "<", "<=", "IN", "NOT IN"]);

/**
 * One value a date column is compared with, as the instant it names.
 *
 * A Date passes as it is; a string must be ISO 8601, a calendar date or an
 * instant with its offset (`2026-09-01`, `2026-09-01T09:00:00Z`), read by the
 * one strict reader the release schedule uses too. Anything else is refused
 * before a query runs: a value no date can be read from has no rows to match,
 * and passing it on let each dialect decide alone what it meant.
 */
function dateOperand(key: string, value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const reading = readIsoDateOrInstant(value);
    if (reading.ok) return reading.at;
  }
  return refuseKey(
    key,
    "FILTER_INVALID_OPERAND",
    `"${key}" is compared with a date: write one as ISO 8601, such as 2026-09-01 or 2026-09-01T09:00:00Z.`
  );
}

/**
 * An instant as this column compares it, on the column's own dialect.
 *
 * - SQLite stores an integer in the column's unit (seconds, or milliseconds),
 *   and its own encoder FLOORS a Date to that unit, so a bound at `.500` would
 *   be compared as the second before it. The number is bound as it is, the
 *   fraction kept, so `less_than` `.500` keeps a row at `.000` and `equals`
 *   `.500` matches none, as on PostgreSQL.
 * - PostgreSQL and MySQL take the Date through the column's own encoder: the
 *   UTC wall clock every Nextly write stores. MySQL reads that wall clock in
 *   the session time zone on both sides, so a bound compares like the stored
 *   rows whenever writes and reads share a session zone, which is the
 *   contract every Nextly read already relies on.
 */
function dateBound(column: Column, instant: Date): Date | SQL {
  if (is(column, SQLiteTimestamp)) {
    const ms = instant.getTime();
    return sql`${column.mode === "timestamp" ? ms / 1000 : ms}`;
  }
  return instant;
}

/**
 * A comparison's value as the column compares it.
 *
 * Decided by the COLUMN, not by the field's declared type, so every column
 * Drizzle reads and writes as a `Date` (its "object date" columns: the system
 * `createdAt` and `updatedAt`, and every date field) takes the same path on
 * every dialect: the value is read as the instant it names, then spelled as
 * the column's dialect compares an instant. Handed to the column's own driver
 * mapping instead, an ISO string threw on SQLite (which reads `getTime()`)
 * and answered 500, while PostgreSQL and MySQL each interpreted it alone.
 */
function comparisonOperand(
  schemaColumn: Column,
  key: string,
  value: unknown
): unknown {
  if (schemaColumn.dataType !== "object date") return value;
  const bound = (item: unknown) =>
    dateBound(schemaColumn, dateOperand(key, item));
  return Array.isArray(value) ? value.map(bound) : bound(value);
}

export function buildDrizzleCondition(
  whereClause: ReturnType<typeof buildWhereClause>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
  schema: any,
  localizedCtx?: LocalizedQueryContext | null,
  localizedExists?: LocalizedExistsBuilder
): ReturnType<typeof and> | undefined {
  if (!whereClause) {
    return undefined;
  }

  // Helper to build condition from a single WhereCondition
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic where clause structure
  const buildSingleCondition = (condition: any): any => {
    // Check if it's a nested WhereClause (has and/or)
    if (condition.and || condition.or) {
      return buildDrizzleCondition(
        condition,
        schema,
        localizedCtx,
        localizedExists
      );
    }

    // It's a WhereCondition
    const { column, op, value } = condition;

    // A dot path reaches into a field. The paths that can be filtered — into
    // a component — are lifted out before this builder runs, so any path
    // still here would compare the WHOLE head column with the value: a
    // relationship's id with a related entry's name, a group's JSON with one
    // of its children.
    const columnParts = column.split(".");
    if (columnParts.length > 1) {
      refuseKey(
        column,
        "FILTER_UNFILTERABLE_PATH",
        `"${column}" does not reach a field this collection can filter on. To filter by a related entry, look its id up first and filter on the relationship field.`
      );
    }

    // i18n M4c: a filter on a localized field targets the companion table (absent from the
    // main schema). Resolve it to a companion EXISTS on the requested locale so the filter
    // takes effect instead of being silently skipped.
    const localizedWhereField = localizedCtx?.localizedFields.find(
      f => f.name === columnParts[0]
    );
    if (localizedCtx && localizedWhereField) {
      const localizedCond = localizedExists?.(
        localizedCtx,
        localizedWhereField.column,
        op,
        value
      );
      if (localizedCond) return localizedCond;
      // The field lives in the companion table, so the main table has no
      // column to fall back on: without a companion condition it cannot be
      // filtered at all.
      refuseKey(
        column,
        "FILTER_UNKNOWN_OPERATOR",
        `"${column}" cannot be filtered with this operator in a language.`
      );
    }

    const schemaColumn = resolveColumn(schema, columnParts[0]);
    // Read once, for every comparison, so a date column's operand is the same
    // instant whichever operator compares it.
    const operand = COMPARISONS.has(op)
      ? comparisonOperand(schemaColumn, column, value)
      : value;

    switch (op) {
      case "=":
        return eq(schemaColumn, operand);
      case "!=":
        return ne(schemaColumn, operand);
      case ">":
        return gt(schemaColumn, operand);
      case ">=":
        return gte(schemaColumn, operand);
      case "<":
        return lt(schemaColumn, operand);
      case "<=":
        return lte(schemaColumn, operand);
      case "LIKE":
        return like(schemaColumn, value);
      case "ILIKE":
        // Lower-cased on both sides, as the adapter compiles ILIKE: only PostgreSQL has the
        // keyword, and a bare LIKE follows the column's collation.
        return sql`lower(${schemaColumn}) like lower(${value})`;
      case "ICONTAINS":
        return caseInsensitiveContains(schemaColumn, String(value));
      case "IN":
        // The filter shape refuses an empty `in` and drops an empty
        // `not_in` before this point; refused again here rather than skipped,
        // because a skipped `in` matched every row.
        if (Array.isArray(operand) && operand.length > 0) {
          return inArray(schemaColumn, operand);
        }
        return refuseKey(
          column,
          "FILTER_EMPTY_IN",
          `"in" on "${column}" needs a list with at least one value.`
        );
      case "NOT IN":
        if (Array.isArray(operand) && operand.length > 0) {
          return notInArray(schemaColumn, operand);
        }
        // An empty list excludes nothing. Rendered as true rather than left
        // out, so it reaches here and its column is resolved first, and so an
        // `or` holding it is true as written.
        if (Array.isArray(value)) return sql`1 = 1`;
        return refuseKey(
          column,
          "FILTER_INVALID_OPERAND",
          `"not_in" on "${column}" needs a list.`
        );
      case "IS NULL":
        return isNull(schemaColumn);
      case "IS NOT NULL":
        return isNotNull(schemaColumn);
      default:
        return refuseKey(
          column,
          "FILTER_UNKNOWN_OPERATOR",
          `"${String(op)}" is not an operator this builder can apply to "${column}".`
        );
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle SQL condition accumulator
  const conditions: any[] = [];

  // Handle AND conditions
  if (whereClause.and && Array.isArray(whereClause.and)) {
    const andConditions = whereClause.and
      .map(buildSingleCondition)
      .filter(Boolean);
    if (andConditions.length > 0) {
      conditions.push(and(...andConditions));
    }
  }

  // Handle OR conditions. A disjunction with no members is false, so an
  // empty list matches no row; dropping it would match every row instead. A
  // member that compiles to no condition is true, and makes the whole
  // disjunction true, so the `or` then contributes nothing.
  if (whereClause.or && Array.isArray(whereClause.or)) {
    const orConditions = whereClause.or.map(buildSingleCondition);
    if (orConditions.length === 0) {
      conditions.push(sql`1 = 0`);
    } else if (orConditions.every(Boolean)) {
      conditions.push(or(...orConditions));
    }
  }

  // Return combined conditions
  if (conditions.length === 0) {
    return undefined;
  }
  if (conditions.length === 1) {
    return conditions[0];
  }
  return and(...conditions);
}

/**
 * Build EXISTS subquery conditions for component field filters.
 *
 * Generates SQL EXISTS subqueries to filter entries based on component field values.
 * Each component filter results in an EXISTS clause against the component data table.
 *
 * @param componentFilters - Component field filters extracted from where clause
 * @param parentTableName - Name of the parent table (e.g., 'dc_pages')
 * @param parentIdColumn - Reference to the parent table's id column
 * @param dialect - Database dialect for operator handling
 * @returns Combined Drizzle SQL condition or undefined if no filters
 *
 * @example
 * ```typescript
 * // For filter: { 'seo.metaTitle': { contains: 'About' } }
 * // Generates: EXISTS (SELECT 1 FROM comp_seo WHERE _parent_id = dc_pages.id AND _parent_table = 'dc_pages' AND meta_title ILIKE '%About%')
 * ```
 */
/**
 * Physical table name for every component slug referenced by these filters.
 *
 * Resolved through the registry because a component with a custom `dbName`
 * has a table name that cannot be derived from its slug. Skipped entirely
 * when no component filter is present, so ordinary queries take no extra
 * round trip.
 */
