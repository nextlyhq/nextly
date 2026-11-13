/**
 * Filtering a field that keeps a list of related entries' ids in its own column: a `hasMany`
 * relationship or upload to one collection, stored as a JSON list on every dialect.
 *
 * Compared whole, as a scalar column is, `in` and `equals` matched nothing a site would ask for:
 * the column is a list, never one id. And `contains`, `search` and `like` matched the list's text,
 * so an id found part of another id (`a` inside `ab`). So on such a field the operators match by
 * membership: `in` and `equals` an entry holding any of the ids, `not_in` and `not_equals` an
 * entry holding none of them, an entry with no related entries included, and the text operators
 * are refused, naming the operator to use.
 *
 * A collection's ids are UUIDs, so each is compared as a string. A value that is not a list (NULL,
 * or anything an older write left) holds no id.
 *
 * @module domains/collections/query/reference-list-membership
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { not, sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { NextlyError } from "../../../errors/nextly-error";
import {
  relationshipStoresJson,
  usesJunctionTable,
} from "../../schema/services/field-column-descriptor";

/** A declared field, as far as whether it keeps a list of ids decides. */
interface ListFieldLike {
  name: string;
  type: string;
  hasMany?: boolean;
  relationTo?: unknown;
  options?: unknown;
}

/**
 * Whether `field` keeps a list of ids, one collection's, in its own column: a `hasMany`
 * relationship or upload naming one collection. One naming several keeps `{ relationTo, value }`
 * objects, and is not read here; a many-to-many keeps its links in a junction table, not a column.
 */
export function holdsReferenceList(field: ListFieldLike): boolean {
  return (
    relationshipStoresJson(field) &&
    !usesJunctionTable(field) &&
    Boolean(field.hasMany) &&
    typeof field.relationTo === "string"
  );
}

/** The names of `fields` that keep a list of ids (`holdsReferenceList`). */
export function referenceListFields(
  fields: readonly ListFieldLike[]
): ReadonlySet<string> {
  return new Set(fields.filter(holdsReferenceList).map(field => field.name));
}

/** Whether the list in `column` holds at least one of `ids`. */
function holdsAny(
  dialect: SupportedDialect,
  column: SQLWrapper,
  ids: readonly unknown[]
): SQL {
  const listed = sql.join(
    ids.map(id => sql`${String(id)}`),
    sql`, `
  );
  if (dialect === "postgresql") {
    // `::jsonb` so a `json` column reads as the `jsonb` one does; anything not an array is read as
    // an empty one, which `jsonb_array_elements_text` would otherwise refuse.
    return sql`exists (select 1 from jsonb_array_elements_text(case when jsonb_typeof((${column})::jsonb) = 'array' then (${column})::jsonb else '[]'::jsonb end) as nextly_listed(id) where nextly_listed.id in (${listed}))`;
  }
  if (dialect === "mysql") {
    // `JSON_CONTAINS` with the id as a JSON string, once per id: MySQL evaluates a `JSON_TABLE`
    // argument before it has the outer row, so the list cannot be read row by row as below. A NULL
    // list reads as no, as one holding none of the ids does, so `not_in` keeps an entry with none.
    return sql`(${sql.join(
      ids.map(
        id =>
          sql`coalesce(json_contains(${column}, json_quote(${String(id)})), 0) = 1`
      ),
      sql` or `
    )})`;
  }
  // SQLite keeps the list as text. CASE runs its branches lazily, so `json_type` reads only text
  // `json_valid` accepted, and anything else is an empty list.
  return sql`exists (select 1 from json_each(case when json_valid(${column}) then (case when json_type(${column}) = 'array' then ${column} else '[]' end) else '[]' end) as nextly_listed where cast(nextly_listed.value as text) in (${listed}))`;
}

/** A refusal of `where.<column>`, a 400 the caller can act on. */
function refuse(column: string, code: string, message: string): never {
  throw NextlyError.validation({
    errors: [{ path: `where.${column}`, code, message }],
  });
}

/**
 * The condition `op` with `value` makes on `column`, a field keeping a list of ids
 * (`holdsReferenceList`); `op` is the compiled operator (`=`, `IN`, `ICONTAINS`, ...).
 */
export function referenceListCondition(args: {
  dialect: SupportedDialect;
  column: SQLWrapper;
  /** The filter key, named in a refusal. */
  name: string;
  op: string;
  value: unknown;
}): SQL {
  const { dialect, column, name, op, value } = args;
  switch (op) {
    case "=":
      return holdsAny(dialect, column, [value]);
    case "!=":
      return not(holdsAny(dialect, column, [value]));
    case "IN":
      // The filter shape refuses an empty `in` before this point; refused again rather than
      // skipped, because a skipped `in` matched every entry.
      if (Array.isArray(value) && value.length > 0) {
        return holdsAny(dialect, column, value);
      }
      return refuse(
        name,
        "FILTER_EMPTY_IN",
        `"in" on "${name}" needs a list with at least one value.`
      );
    case "NOT IN":
      if (Array.isArray(value) && value.length > 0) {
        return not(holdsAny(dialect, column, value));
      }
      // An empty list excludes nothing.
      if (Array.isArray(value)) return sql`1 = 1`;
      return refuse(
        name,
        "FILTER_INVALID_OPERAND",
        `"not_in" on "${name}" needs a list.`
      );
    case "IS NULL":
      return sql`${column} is null`;
    case "IS NOT NULL":
      return sql`${column} is not null`;
    case "LIKE":
    case "ILIKE":
    case "ICONTAINS":
      return refuse(
        name,
        "FILTER_OPERATOR_NOT_FOR_LIST",
        `"${name}" holds a list of related entries, which "contains", "search" and "like" can't match. To find entries related to one of them, use { "in": ["<id>"] }.`
      );
    default:
      return refuse(
        name,
        "FILTER_OPERATOR_NOT_FOR_LIST",
        `"${name}" holds a list of related entries. Filter it with "in", "not_in", "equals", "not_equals" or "exists".`
      );
  }
}
