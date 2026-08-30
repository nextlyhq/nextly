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

/**
 * The caller's query with every property read EXACTLY ONCE, into locals
 * nothing outside this module can reach.
 *
 * `validateWidgetQuery` is public API, so its argument may be a Proxy or carry
 * accessors, and an accessor is free to answer differently on each call. Every
 * property that is read twice -- once to check it, once to build the returned
 * object -- is therefore a TOCTOU: the value that was validated and the value
 * that ships can differ. An earlier commit closed this for `where` by cloning
 * before the walk and left the other five open, which is one gap per family
 * member rather than one gap.
 *
 * Reading them all here, up front, is what makes the invariant structural: no
 * later step can read the caller's object again, because no later step is
 * handed it.
 */
interface RawWidgetQuery {
  source: unknown;
  op: unknown;
  where: unknown;
  status: unknown;
  select: unknown;
  sort: unknown;
  limit: unknown;
}

/** Narrows `unknown` to an object, then takes its one read of each property. */
function readEachFieldOnce(query: unknown): RawWidgetQuery {
  if (typeof query !== "object" || query === null) fail("expected an object");
  const q = query as Record<string, unknown>;
  return {
    source: q.source,
    op: q.op,
    where: q.where,
    status: q.status,
    select: q.select,
    sort: q.sort,
    limit: q.limit,
  };
}

/** Resolves `source` against the registry. A caller-invented id cannot exist here. */
function resolveSource(source: unknown): WidgetSource {
  if (typeof source !== "string") fail("source is required");
  const found = getSource(source);
  if (!found) fail(`unknown source "${source}"`);
  return found;
}

/** Confirms the source declares support for the requested op. */
function assertSupportedOp(source: WidgetSource, op: unknown): WidgetOp {
  if (typeof op !== "string" || !source.supports.includes(op as WidgetOp)) {
    fail(`source "${source.id}" does not support op "${String(op)}"`);
  }
  return op as WidgetOp;
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
 * Confirms a field's condition value is usable, and returns its operator
 * entries to check -- or `undefined` for a bare scalar, which has no keys
 * of its own and so nothing further to check (it is an implicit equality
 * test, e.g. `{ status: "draft" }`, and is accepted as-is).
 *
 * `null` and `{}` are refused rather than treated as "nothing to check
 * either": both compile to NO condition at all downstream --
 * `buildWhereClause` does `if (value === null) continue`, and `{}` has no
 * operator keys for `isFieldCondition` to recognise. An accepted query whose
 * author wrote a condition that silently vanishes returns a WIDER result
 * set than the query reads as promising, which is exactly the "accepted
 * means something different from what it says" failure this validator
 * exists to prevent.
 *
 * An array under a field name is refused too: it matches none of the shapes
 * the query operators produce (`buildWhereClause` treats it as neither a
 * field condition nor plain equality and silently drops it), so admitting
 * it here would be a no-op at best and a hiding place for a nested field
 * reference (`["x", { secretScore: 1 }]`) at worst.
 */
function assertFieldConditionUsable(
  field: string,
  value: unknown
): Array<[string, unknown]> | undefined {
  if (value === null) {
    fail(`where condition for "${field}" is null, which matches every row`);
  }
  if (typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    fail(
      `where condition for "${field}" must be an operator object, not an array`
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    fail(`where condition for "${field}" is empty, which matches every row`);
  }
  return entries;
}

/** Confirms `operator` is one the query layer actually understands. */
function assertOperatorAllowed(field: string, operator: string): void {
  if (!isAllowedWhereOperator(operator)) {
    fail(`where uses unknown operator "${operator}" on field "${field}"`);
  }
}

/**
 * Confirms an operator's value is not itself a plain object. None of the
 * operators in the vocabulary take an object as their value (comparisons
 * take scalars, `in`/`not_in` take arrays), so an object here has no
 * legitimate use and is the only place left a field name could hide -- it
 * is refused rather than walked for exactly that reason: there is no
 * operator whose semantics a nested object could ever satisfy.
 */
function assertOperatorValueShape(
  field: string,
  operator: string,
  operatorValue: unknown
): void {
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

/**
 * Confirms a single field's condition value cannot smuggle in an operator or
 * a field name the earlier checks never see, and cannot silently compile to
 * no condition at all (see `assertFieldConditionUsable`).
 */
function assertFieldConditionShape(field: string, value: unknown): void {
  const entries = assertFieldConditionUsable(field, value);
  if (!entries) return;
  for (const [operator, operatorValue] of entries) {
    assertOperatorAllowed(field, operator);
    assertOperatorValueShape(field, operator, operatorValue);
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

/**
 * Clones `where` up front -- before anything reads a single property of it
 * -- and returns that clone, or `undefined` if there was no `where` to
 * begin with. Every later step (the walk, and the value returned to the
 * caller) operates on this SAME clone, never on the caller's original
 * object.
 *
 * This closes a TOCTOU a clone-AFTER-validation order left open: a getter
 * or Proxy on the caller's object can answer one value the first time a
 * property is read and a different, hostile value the next time. With
 * validate-then-clone, the walk's read and the later `structuredClone` read
 * were two separate reads of the same accessor, and an accessor is free to
 * answer differently each time it's called -- the walk could approve `{
 * and: [] }` on its read and `structuredClone` could then capture `{ and:
 * [{ secretScore: {...} }] }` moments later into the object actually
 * returned. Reading each property exactly once, by validating the clone
 * instead of the original, removes the seam that bug lived in: whatever the
 * accessor returns on its one and only invocation is both what gets
 * validated and what gets returned, with no way for those to diverge.
 *
 * `structuredClone` throws a raw `DOMException`/`TypeError` on a value it
 * cannot clone (a function, symbol, or bigint nested in `where`) -- fails
 * closed, but as an error outside the `NextlyError` contract, which would
 * surface as an unhandled 500 rather than a named 400. Wrapped here so it
 * reads the same as every other refusal in this module.
 */
function cloneWhereOrUndefined(
  where: unknown
): Record<string, unknown> | undefined {
  if (where === undefined) return undefined;
  if (typeof where !== "object" || where === null) {
    fail("where must be an object");
  }
  try {
    return structuredClone(where) as Record<string, unknown>;
  } catch {
    fail(
      "where contains a value that cannot be cloned (functions, symbols, and bigints are not supported)"
    );
  }
}

/** Confirms every field named in `where` was declared, at every nesting depth. */
function assertWhereFieldsDeclared(
  source: WidgetSource,
  where: Record<string, unknown> | undefined,
  declared: ReadonlySet<string>
): void {
  if (where === undefined) return;
  walkWhereClause(where, 0, source, declared);
}

/**
 * Copies `select` up front -- reading each element exactly once -- and returns
 * that copy, which is both what gets validated and what gets returned.
 *
 * The same reasoning as `cloneWhereOrUndefined`, one level down: validating
 * the caller's array and then spreading it into the result is two reads of
 * every index, and an index can be an accessor too.
 */
function copySelectOrUndefined(select: unknown): string[] | undefined {
  if (select === undefined) return undefined;
  if (!Array.isArray(select)) fail("select must be an array of field names");
  return [...(select as unknown[])] as string[];
}

/** Confirms every field named in `select` was declared by the source. */
function assertSelectFieldsDeclared(
  source: WidgetSource,
  select: string[] | undefined,
  declared: ReadonlySet<string>
): void {
  if (select === undefined) return;
  for (const field of select) {
    if (typeof field !== "string" || !declared.has(field)) {
      fail(
        `select references undeclared field "${String(field)}" on "${source.id}"`
      );
    }
  }
}

/**
 * Confirms the field named in `sort` was declared by the source, and returns
 * the string it checked. `sort` may carry a leading `-` for descending order;
 * it is stripped before checking, or `-secretScore` would slip an undeclared
 * field past this guard.
 */
function assertSortFieldDeclared(
  source: WidgetSource,
  sort: unknown,
  declared: ReadonlySet<string>
): string | undefined {
  if (sort === undefined) return undefined;
  if (typeof sort !== "string") fail("sort must be a string");
  const field = sort.startsWith("-") ? sort.slice(1) : sort;
  if (!declared.has(field)) {
    fail(`sort references undeclared field "${field}" on "${source.id}"`);
  }
  return sort;
}

/** Confirms `status`, when present, is one of the known values, and returns it. */
function assertValidStatus(status: unknown): WidgetQuery["status"] | undefined {
  if (status === undefined) return undefined;
  if (!VALID_STATUSES.includes(status as WidgetQuery["status"] & string)) {
    fail(`status must be one of ${VALID_STATUSES.join(", ")}`);
  }
  return status as WidgetQuery["status"];
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
function clampLimit(limit: unknown): number {
  const requested = Number.isFinite(limit)
    ? Math.trunc(limit as number)
    : DEFAULT_WIDGET_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_WIDGET_LIMIT);
}

/**
 * Validate and normalize. Returns a query fully independent of the input.
 *
 * EVERY property of the caller's object is read exactly once, by
 * `readEachFieldOnce`, before any of them is inspected -- and every later step
 * works on those locals, so nothing downstream is even handed the caller's
 * object to read again. The composite values are copied at that same moment:
 * `where` by `structuredClone` and `select` element by element, so their
 * insides get the same single read.
 *
 * That is the whole point, and it is why the invariant is stated over the
 * whole query rather than over `where` alone. A getter or Proxy is free to
 * answer differently on each call, so any property read twice -- once to check
 * it, once to build the result -- is a value that can be certified and then
 * swapped: a `sort` answering "title" to the guard and "-secretScore" to the
 * return spread yields a query whose sort was never checked. There is no seam
 * for that here, because there is no second read.
 *
 * The returned query is safe to compile: its source exists, its op is
 * supported, every field it names was declared by that source (at every
 * `where` nesting depth, and only via operators the query layer actually
 * understands, on conditions that are neither `null` nor empty), and its
 * limit is a bounded, finite integer.
 */
export function validateWidgetQuery(query: unknown): WidgetQuery {
  const raw = readEachFieldOnce(query);

  const source = resolveSource(raw.source);
  const op = assertSupportedOp(source, raw.op);
  const declared = new Set(source.fields.map(f => f.name));

  const where = cloneWhereOrUndefined(raw.where);
  const select = copySelectOrUndefined(raw.select);

  assertWhereFieldsDeclared(source, where, declared);
  assertSelectFieldsDeclared(source, select, declared);
  const sort = assertSortFieldDeclared(source, raw.sort, declared);
  const status = assertValidStatus(raw.status);

  return {
    source: source.id,
    op,
    ...(where ? { where } : {}),
    ...(status ? { status } : {}),
    ...(select ? { select } : {}),
    ...(sort ? { sort } : {}),
    limit: clampLimit(raw.limit),
  };
}
