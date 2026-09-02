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
import type { SQL } from "drizzle-orm";
import {
  and,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  like,
  ilike,
  isNull,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";

import type { LocalizedFieldRef } from "../../domains/i18n/companion-join";
import { buildCompanionExists } from "../../domains/i18n/companion-join";

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
  value: unknown,
  dialect: string
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
  value: unknown,
  dialect: string
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
      valueCondition =
        dialect === "postgresql"
          ? sql`${t}.${col} ILIKE ${value}`
          : sql`${t}.${col} LIKE ${value}`;
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

export function buildDrizzleCondition(
  whereClause: ReturnType<typeof buildWhereClause>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle dynamic schema
  schema: any,
  dialect: string = "postgresql",
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
        dialect,
        localizedCtx,
        localizedExists
      );
    }

    // It's a WhereCondition
    const { column, op, value } = condition;

    // Get the column from schema (handle dot notation for nested fields)
    const columnParts = column.split(".");

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
        value,
        dialect
      );
      if (localizedCond) return localizedCond;
    }

    const schemaColumn = schema[columnParts[0]];

    if (!schemaColumn) {
      // Column doesn't exist in schema, skip this condition
      return undefined;
    }

    switch (op) {
      case "=":
        return eq(schemaColumn, value);
      case "!=":
        return ne(schemaColumn, value);
      case ">":
        return gt(schemaColumn, value);
      case ">=":
        return gte(schemaColumn, value);
      case "<":
        return lt(schemaColumn, value);
      case "<=":
        return lte(schemaColumn, value);
      case "LIKE":
        return like(schemaColumn, value);
      case "ILIKE":
        // Use ILIKE for PostgreSQL, LIKE for others
        if (dialect === "postgresql") {
          return ilike(schemaColumn, value);
        }
        return like(schemaColumn, value);
      case "IN":
        if (Array.isArray(value) && value.length > 0) {
          return inArray(schemaColumn, value);
        }
        return undefined;
      case "NOT IN":
        if (Array.isArray(value) && value.length > 0) {
          return notInArray(schemaColumn, value);
        }
        return undefined;
      case "IS NULL":
        return isNull(schemaColumn);
      case "IS NOT NULL":
        return isNotNull(schemaColumn);
      default:
        return undefined;
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

  // Handle OR conditions
  if (whereClause.or && Array.isArray(whereClause.or)) {
    const orConditions = whereClause.or
      .map(buildSingleCondition)
      .filter(Boolean);
    if (orConditions.length > 0) {
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
