/**
 * A widget's data request, as structured data.
 *
 * It is never a string, never SQL, and never a query language typed by a user.
 * Metabase and Superset both ship a structured IR for exactly this reason: an
 * opaque query string cannot be checked before execution, so row-level security
 * silently does not apply to it. Everything here resolves against the source
 * registry before it reaches the compiler.
 *
 * @module domains/widgets/query
 */

import { NextlyError } from "../../errors/nextly-error";
import {
  GEO_OPERATORS,
  isValidOperator,
} from "../collections/query/query-operators";

import { getSource, type WidgetOp, type WidgetSource } from "./sources";

/** Nothing may return more rows than this, whatever the caller asked for. */
export const MAX_WIDGET_LIMIT = 50;

/** The default row count when a caller does not specify one, or specifies garbage. */
const DEFAULT_WIDGET_LIMIT = 5;

/** How deep a `where` clause may nest before validation itself gets expensive. */
const MAX_WHERE_DEPTH = 8;

const VALID_STATUSES = ["published", "draft", "all"] as const;

export interface WidgetQuery {
  source: string;
  op: WidgetOp;
  where?: Record<string, unknown>;
  status?: "published" | "draft" | "all";
  select?: string[];
  sort?: string;
  limit?: number;
}

/**
 * Product code in `packages/nextly/**` throws `NextlyError`, never a bare
 * `Error` (repo lint rule). `.message` is set verbatim from this string, so
 * the tests' regex assertions match unchanged.
 */
function fail(message: string): never {
  throw NextlyError.invalidInput({
    message: `Invalid widget query: ${message}`,
  });
}

/** Narrows `unknown` to a plain, non-null object shape we can inspect. */
function asRecord(query: unknown): Partial<WidgetQuery> {
  if (typeof query !== "object" || query === null) fail("expected an object");
  return query;
}

/** Resolves `source` against the registry. A caller-invented id cannot exist here. */
function resolveSource(q: Partial<WidgetQuery>): WidgetSource {
  if (typeof q.source !== "string") fail("source is required");
  const source = getSource(q.source);
  if (!source) fail(`unknown source "${q.source}"`);
  return source;
}

/** Confirms the source declares support for the requested op. */
function assertSupportedOp(
  source: WidgetSource,
  q: Partial<WidgetQuery>
): WidgetOp {
  if (typeof q.op !== "string" || !source.supports.includes(q.op)) {
    fail(`source "${source.id}" does not support op "${String(q.op)}"`);
  }
  return q.op;
}

/**
 * Whether `operator` is a key the query layer actually understands, DERIVED
 * from the same vocabulary the collections query compiler uses -- not a
 * hand-kept copy of it. A hand-kept list would agree with
 * `query-operators.ts` on the day it was written and silently stop agreeing
 * the next time an operator is added or renamed there. See
 * `domains/collections/query/query-operators.ts` (`isValidOperator`, the
 * `QueryOperator` union `buildWhereClause` accepts) and, one layer down,
 * `WHERE_OPERATORS` in `packages/adapter-drizzle/src/types/query.ts` for the
 * SQL-facing operators those compile to.
 */
function isAllowedWhereOperator(operator: string): boolean {
  return isValidOperator(operator) || GEO_OPERATORS.has(operator);
}

/**
 * Confirms a single field's condition value cannot smuggle in an operator or
 * a field name the earlier checks never see.
 *
 * A bare scalar (string/number/boolean/null) is an implicit equality test --
 * `{ status: "draft" }` -- and is accepted as-is: it has no keys of its own,
 * so there is nothing further to check. An array under a field name matches
 * none of the shapes the query operators produce (`buildWhereClause` treats
 * it as neither a field condition nor plain equality and silently drops it),
 * so admitting it here would be a no-op at best and a hiding place for a
 * nested field reference (`["x", { secretScore: 1 }]`) at worst -- refused.
 * Otherwise the value must be a plain object whose every key is a known
 * operator, and whose every operator VALUE is not itself a plain object:
 * none of the operators in the vocabulary take an object as their value
 * (comparisons take scalars, `in`/`not_in` take arrays), so an object there
 * has no legitimate use and is the only place left a field name could hide.
 * It is refused rather than walked for exactly that reason -- there is no
 * operator whose semantics a nested object could ever satisfy.
 */
function assertFieldConditionShape(field: string, value: unknown): void {
  if (value === null || typeof value !== "object") return;

  if (Array.isArray(value)) {
    fail(
      `where condition for "${field}" must be an operator object, not an array`
    );
  }

  for (const [operator, operatorValue] of Object.entries(value)) {
    if (!isAllowedWhereOperator(operator)) {
      fail(`where uses unknown operator "${operator}" on field "${field}"`);
    }
    if (
      operatorValue !== null &&
      typeof operatorValue === "object" &&
      !Array.isArray(operatorValue)
    ) {
      fail(
        `where operator "${operator}" on field "${field}" may not take a nested object`
      );
    }
  }
}

/**
 * Confirms an `and`/`or` combinator's value is shaped the only way it may
 * legitimately be shaped: an array of condition objects.
 *
 * This is the fix for the hole where a non-array combinator value used to be
 * coerced to zero branches (`Array.isArray(value) ? value : []`) -- which
 * walked nothing, refused nothing, and let `{ and: { secretScore: {...} } }`
 * through with `secretScore` never added to the referenced-fields set and
 * never refused. A non-array value, or a non-object element inside the
 * array, is refused outright rather than coerced into "zero branches" or
 * skipped: coercing a malformed shape into an empty, harmless-looking one is
 * exactly how it went unrefused before.
 */
function assertCombinatorBranches(
  key: "and" | "or",
  value: unknown
): unknown[] {
  if (!Array.isArray(value)) {
    fail(`where "${key}" must be an array of conditions`);
  }
  for (const branch of value) {
    if (
      branch === null ||
      typeof branch !== "object" ||
      Array.isArray(branch)
    ) {
      fail(`where "${key}" branch must be an object`);
    }
  }
  return value;
}

/**
 * Walks a `where` clause at any nesting depth, refusing (rather than
 * skipping) anything malformed: an over-deep clause, a malformed `and`/`or`,
 * an undeclared field, or a field condition using an unknown operator or
 * hiding a nested object under one.
 */
function walkWhereClause(
  where: Record<string, unknown>,
  depth: number,
  source: WidgetSource,
  declared: ReadonlySet<string>
): void {
  if (depth > MAX_WHERE_DEPTH) {
    fail(`where clause is nested too deeply (max ${MAX_WHERE_DEPTH})`);
  }
  for (const [key, value] of Object.entries(where)) {
    if (key === "and" || key === "or") {
      const branches = assertCombinatorBranches(key, value);
      for (const branch of branches) {
        walkWhereClause(
          branch as Record<string, unknown>,
          depth + 1,
          source,
          declared
        );
      }
      continue;
    }
    if (!declared.has(key)) {
      fail(`where references undeclared field "${key}" on "${source.id}"`);
    }
    assertFieldConditionShape(key, value);
  }
}

/** Confirms every field named in `where` was declared, at every nesting depth. */
function assertWhereFieldsDeclared(
  source: WidgetSource,
  q: Partial<WidgetQuery>,
  declared: ReadonlySet<string>
): void {
  if (q.where === undefined) return;
  if (typeof q.where !== "object" || q.where === null) {
    fail("where must be an object");
  }
  walkWhereClause(q.where, 0, source, declared);
}

/** Confirms every field named in `select` was declared by the source. */
function assertSelectFieldsDeclared(
  source: WidgetSource,
  q: Partial<WidgetQuery>,
  declared: ReadonlySet<string>
): void {
  if (q.select === undefined) return;
  if (!Array.isArray(q.select)) fail("select must be an array of field names");
  for (const field of q.select) {
    if (typeof field !== "string" || !declared.has(field)) {
      fail(
        `select references undeclared field "${String(field)}" on "${source.id}"`
      );
    }
  }
}

/**
 * Confirms the field named in `sort` was declared by the source. `sort` may
 * carry a leading `-` for descending order; it is stripped before checking,
 * or `-secretScore` would slip an undeclared field past this guard.
 */
function assertSortFieldDeclared(
  source: WidgetSource,
  q: Partial<WidgetQuery>,
  declared: ReadonlySet<string>
): void {
  if (q.sort === undefined) return;
  if (typeof q.sort !== "string") fail("sort must be a string");
  const field = q.sort.startsWith("-") ? q.sort.slice(1) : q.sort;
  if (!declared.has(field)) {
    fail(`sort references undeclared field "${field}" on "${source.id}"`);
  }
}

/** Confirms `status`, when present, is one of the known values. */
function assertValidStatus(q: Partial<WidgetQuery>): void {
  if (q.status !== undefined && !VALID_STATUSES.includes(q.status)) {
    fail(`status must be one of ${VALID_STATUSES.join(", ")}`);
  }
}

/**
 * Clamps rather than rejects: a widget asking for too much is a
 * configuration mistake, not an attack, and silently bounding it keeps the
 * card working instead of failing it outright.
 *
 * `Number.isFinite` is the guard, not `typeof q.limit === "number"`: `NaN`
 * IS `typeof "number"`, and every comparison against `NaN` (including
 * `Math.min`/`Math.max`) itself evaluates to `NaN`, so a plain
 * `Math.min(Math.max(NaN, 1), MAX)` returns `NaN` -- an unclamped, unbounded
 * `LIMIT NaN` reaching the compiler despite this function's entire purpose.
 * `Math.trunc` on the finite branch closes the neighbouring gap where a
 * fractional limit (`5.7`) passed the old numeric check unchanged.
 */
function clampLimit(q: Partial<WidgetQuery>): number {
  const requested = Number.isFinite(q.limit)
    ? Math.trunc(q.limit as number)
    : DEFAULT_WIDGET_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_WIDGET_LIMIT);
}

/**
 * Validate and normalize. Returns a query fully independent of the input:
 * a fresh envelope AND a deep copy of `where` (via `structuredClone`), not a
 * fresh object wrapped around a shared `where` reference. Without the deep
 * copy, code holding the pre-validation object could mutate an undeclared
 * field INTO the validated query after it already passed the gate -- the
 * envelope would be fresh, but the safety it is supposed to certify would
 * not be.
 *
 * The returned query is safe to compile: its source exists, its op is
 * supported, every field it names was declared by that source (at every
 * `where` nesting depth, and only via operators the query layer actually
 * understands), and its limit is a bounded, finite integer.
 */
export function validateWidgetQuery(query: unknown): WidgetQuery {
  const q = asRecord(query);
  const source = resolveSource(q);
  const op = assertSupportedOp(source, q);
  const declared = new Set(source.fields.map(f => f.name));

  assertWhereFieldsDeclared(source, q, declared);
  assertSelectFieldsDeclared(source, q, declared);
  assertSortFieldDeclared(source, q, declared);
  assertValidStatus(q);

  return {
    source: source.id,
    op,
    ...(q.where ? { where: structuredClone(q.where) } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.select ? { select: [...q.select] } : {}),
    ...(q.sort ? { sort: q.sort } : {}),
    limit: clampLimit(q),
  };
}
