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

import { getSource, type WidgetOp, type WidgetSource } from "./sources";

/** Nothing may return more rows than this, whatever the caller asked for. */
export const MAX_WIDGET_LIMIT = 50;

/** The default row count when a caller does not specify one. */
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
 * Every field name a `where` clause references, at any nesting depth.
 * Depth is capped so an adversarial caller cannot make validation itself the
 * expensive operation by nesting `and`/`or` past any reasonable query shape.
 */
function collectWhereFields(
  where: Record<string, unknown>,
  depth: number,
  out: Set<string>
): void {
  if (depth > MAX_WHERE_DEPTH) {
    fail(`where clause is nested too deeply (max ${MAX_WHERE_DEPTH})`);
  }
  for (const [key, value] of Object.entries(where)) {
    if (key === "and" || key === "or") {
      collectWhereBranches(value, depth, out);
      continue;
    }
    out.add(key);
  }
}

/** Recurses into the branches of an `and`/`or` combinator. */
function collectWhereBranches(
  value: unknown,
  depth: number,
  out: Set<string>
): void {
  const branches = Array.isArray(value) ? value : [];
  for (const branch of branches) {
    if (branch && typeof branch === "object") {
      collectWhereFields(branch as Record<string, unknown>, depth + 1, out);
    }
  }
}

/** Confirms every field named in `where` was declared by the source. */
function assertWhereFieldsDeclared(
  source: WidgetSource,
  q: Partial<WidgetQuery>,
  declared: ReadonlySet<string>
): void {
  if (q.where === undefined) return;
  if (typeof q.where !== "object" || q.where === null) {
    fail("where must be an object");
  }
  const referenced = new Set<string>();
  collectWhereFields(q.where, 0, referenced);
  for (const field of referenced) {
    if (!declared.has(field)) {
      fail(`where references undeclared field "${field}" on "${source.id}"`);
    }
  }
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
 */
function clampLimit(q: Partial<WidgetQuery>): number {
  const requested =
    typeof q.limit === "number" ? q.limit : DEFAULT_WIDGET_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_WIDGET_LIMIT);
}

/**
 * Validate and normalize. Returns a fresh object; never mutates the input.
 *
 * The returned query is safe to compile: its source exists, its op is
 * supported, every field it names was declared by that source, and its limit
 * is bounded.
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
    source: q.source as string,
    op,
    ...(q.where ? { where: q.where } : {}),
    ...(q.status ? { status: q.status } : {}),
    ...(q.select ? { select: [...q.select] } : {}),
    ...(q.sort ? { sort: q.sort } : {}),
    limit: clampLimit(q),
  };
}
