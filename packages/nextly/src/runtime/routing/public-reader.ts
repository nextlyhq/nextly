/**
 * The reader a published page's lists read through: anonymous, published
 * content only, and only fields the public may read.
 *
 * A page is the same for every visitor and is rendered ahead of time, so what
 * it shows must be what anyone may see. The reader is that boundary. A list's
 * query arrives as data (typed filter rows, sort keys, a window) and is
 * translated here into a collection read whose access options are fixed:
 * published status, access rules enforced with no user, unknown sort keys
 * refused. Anything in the query that would widen that, a status, a trusted
 * read, a user, a raw `where`, is refused by name rather than ignored, so a
 * provider that tries learns at once instead of thinking it worked.
 *
 * Filter and sort keys go through core's own guards, which judge them as the
 * anonymous caller's: a field the public may not read can be neither filtered
 * nor sorted on, and never comes back in a row.
 *
 * This is a contract a page builder relies on, not a sandbox: code that holds
 * the Direct API can still read whatever it is trusted to.
 *
 * @module runtime/routing/public-reader
 */
import { z } from "zod";

import { runDetachedFromRequest } from "../../auth/caller-scope";
import type { Nextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ListResult } from "../../direct-api/types/shared";
import { NextlyError } from "../../errors/nextly-error";

/** The operators a list's filter row may use, each meaning the same on every database. */
export const PUBLIC_FILTER_OPS = [
  "equals",
  "not_equals",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "not_in",
  "exists",
] as const;

export type PublicFilterOp = (typeof PUBLIC_FILTER_OPS)[number];

type FilterScalar = string | number | boolean;

/** One filter row: a field, an operator and a typed value. */
export interface PublicFilter {
  field: string;
  op: PublicFilterOp;
  value: FilterScalar | readonly FilterScalar[];
}

/** What a list asks for. Everything else a read could say is the reader's to fix. */
export interface PublicReadQuery {
  collection: string;
  filters?: readonly PublicFilter[];
  /** One key or several in order, `-field` descending; ties break by id. */
  sort?: string | readonly string[];
  /** 1 to 100; 10 when absent. */
  limit?: number;
  /** Rows to skip, from 0. */
  offset?: number;
  /** A page of `limit` rows after the offset, from 1. */
  page?: number;
  /** The route's language; a different one is refused. */
  locale?: string;
  /**
   * The fields each row carries, besides its id. A relationship comes back
   * as the related id: filling it with its entry is not part of a public
   * list's query yet.
   */
  select?: readonly string[];
}

/** The canonical list envelope: the page of rows and its pagination. */
export type PublicReadResult = ListResult<Record<string, unknown>>;

/** What a count may narrow by: the list's collection, filters and language. */
export type PublicCountQuery = Pick<
  PublicReadQuery,
  "collection" | "filters" | "locale"
>;

/** The public reads a page's data provider is given. Nothing else.
 *
 * @experimental
 */
export interface PublicReader {
  find(query: PublicReadQuery): Promise<PublicReadResult>;
  count(query: PublicCountQuery): Promise<number>;
}

/** What a route binds the reader to. */
export interface PublicReaderBinding {
  /** The route's language. Every read answers in it. */
  locale?: string;
}

const QUERY_KEYS: ReadonlySet<string> = new Set([
  "collection",
  "filters",
  "sort",
  "limit",
  "offset",
  "page",
  "locale",
  "select",
]);

/** Core's operator for each public one. */
const CORE_OP: Record<PublicFilterOp, string> = {
  equals: "equals",
  not_equals: "not_equals",
  gt: "greater_than",
  gte: "greater_than_equal",
  lt: "less_than",
  lte: "less_than_equal",
  contains: "contains",
  in: "in",
  not_in: "not_in",
  exists: "exists",
};

/** A field name as a list may write it: no paths, operators or quoting. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

function refuse(reason: string, message: string, detail: object = {}): never {
  throw NextlyError.invalidInput({
    message,
    logContext: { reason: `public-read-${reason}`, ...detail },
  });
}

const scalar = z.union([z.string(), z.number(), z.boolean()]);

/**
 * The shape a query must have before any of it is read: each value of the
 * type it is declared as. A query is outside input (a stored list, a
 * provider's JavaScript), so `select: "title"` is refused here rather than
 * spread into five one-letter fields. The bounds and names are judged after,
 * each refused with its own reason.
 */
const QUERY_SHAPE = z.object({
  collection: z.string(),
  filters: z
    .array(
      z.object({
        field: z.string(),
        op: z.string(),
        value: z.union([scalar, z.array(scalar)]),
      })
    )
    .optional(),
  sort: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  page: z.number().optional(),
  locale: z.string().optional(),
  select: z.array(z.string()).optional(),
});

function assertShape(query: object): void {
  const parsed = QUERY_SHAPE.safeParse(query);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const where = issue?.path.map(String).join(".") || "the query";
  refuse(
    "query-invalid",
    `A list query's ${where} is not of the type it takes: ${issue?.message ?? "invalid"}.`,
    { path: where }
  );
}

/**
 * The sort keys, each trimmed, empty ones dropped. A string is split on
 * commas, as core splits one, so `""`, `" "` and `","` come to no keys and
 * the read keeps its id order instead of reaching core with no order at all.
 */
function sortKeys(sort: string | readonly string[] | undefined): string[] {
  const parts = typeof sort === "string" ? sort.split(",") : [...(sort ?? [])];
  const keys = parts.map(key => key.trim()).filter(key => key !== "");
  // A sign with no field after it is a malformed key, not an absent one:
  // core's parser would drop it, and the refusal of unknown keys never see it.
  const signOnly = keys.filter(key => key.replace(/^-/, "").trim() === "");
  if (signOnly.length > 0) {
    refuse(
      "sort-invalid",
      'A sort key needs a field name after its sign, such as "-date".',
      { keys: signOnly }
    );
  }
  return keys;
}

const COUNT_KEYS: ReadonlySet<string> = new Set([
  "collection",
  "filters",
  "locale",
]);

function assertCountKeys(query: object): void {
  if (query === null || typeof query !== "object") {
    refuse("query-invalid", "A count query must be an object.");
  }
  const extra = Object.keys(query).filter(key => !COUNT_KEYS.has(key));
  if (extra.length > 0) {
    refuse(
      "option-refused",
      `A public count takes a collection, filters and a language only, not ${extra.map(key => `"${key}"`).join(", ")}.`,
      { keys: extra }
    );
  }
}

function assertQueryKeys(query: object): void {
  const extra = Object.keys(query).filter(key => !QUERY_KEYS.has(key));
  if (extra.length > 0) {
    refuse(
      "option-refused",
      `A public list cannot set ${extra.map(key => `"${key}"`).join(", ")}: a page shows published entries and public fields only, to everyone.`,
      { keys: extra }
    );
  }
}

function assertWholeNumber(
  name: string,
  value: number | undefined,
  min: number,
  max = Number.MAX_SAFE_INTEGER
): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    refuse(
      `${name}-invalid`,
      max === Number.MAX_SAFE_INTEGER
        ? `${name} must be a whole number from ${String(min)}.`
        : `${name} must be a whole number from ${String(min)} to ${String(max)}.`,
      { [name]: value }
    );
  }
}

function assertFieldName(
  field: unknown,
  where: string
): asserts field is string {
  // `__proto__` matches the pattern but names no field: core refuses it as a
  // filter key, so it is refused here, before a read is built.
  if (
    typeof field !== "string" ||
    !FIELD_NAME.test(field) ||
    field === "__proto__"
  ) {
    refuse(
      "field-invalid",
      `${where} names "${String(field)}", which is not a field name.`
    );
  }
}

function isScalar(value: unknown): value is FilterScalar {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * Whether a row's value is the kind its operator takes. `in` needs a value
 * to match; an empty `not_in` excludes nothing and is a well-formed list.
 */
function valueFits(op: PublicFilterOp, value: unknown): boolean {
  if (op === "in" || op === "not_in") {
    return (
      Array.isArray(value) &&
      value.every(isScalar) &&
      (op === "not_in" || value.length > 0)
    );
  }
  if (op === "exists") return typeof value === "boolean";
  // Ordering and text matching compare a value; true or false has no order
  // and is no text, so only the equality operators take one.
  if (ORDERED_OR_TEXT.has(op)) {
    return (
      typeof value === "string" ||
      (typeof value === "number" && Number.isFinite(value))
    );
  }
  return isScalar(value);
}

const ORDERED_OR_TEXT: ReadonlySet<PublicFilterOp> = new Set([
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
]);

/** What {@link valueFits} wants, in words, for the refusal. */
function expectedValue(op: PublicFilterOp): string {
  if (op === "in") return "a list of at least one value";
  if (op === "not_in") return "a list of values";
  if (ORDERED_OR_TEXT.has(op)) return "a number or text";
  return op === "exists" ? "true or false" : "one value";
}

/** One filter row as core's `where`, refused when it is not well formed. */
function toCondition(row: PublicFilter): Record<string, unknown> {
  assertFieldName(row.field, "A filter");
  if (!(PUBLIC_FILTER_OPS as readonly string[]).includes(row.op)) {
    refuse(
      "operator-unknown",
      `"${String(row.op)}" is not a filter operator. Use one of: ${PUBLIC_FILTER_OPS.join(", ")}.`
    );
  }
  if (!valueFits(row.op, row.value)) {
    refuse(
      "value-invalid",
      `The value for "${row.field}" ${row.op} must be ${expectedValue(row.op)}.`
    );
  }
  return { [row.field]: { [CORE_OP[row.op]]: row.value } };
}

function toWhere(filters: readonly PublicFilter[] | undefined) {
  if (filters === undefined || filters.length === 0) return undefined;
  if (!Array.isArray(filters))
    refuse("filters-invalid", "filters must be a list.");
  return { and: filters.map(toCondition) };
}

/** Refuse a query that is not one a public list may send, before anything is read. */
function assertPublicQuery(
  query: PublicReadQuery,
  binding: PublicReaderBinding
): void {
  if (query === null || typeof query !== "object") {
    refuse("query-invalid", "A list query must be an object.");
  }
  assertQueryKeys(query);
  assertShape(query);
  if (typeof query.collection !== "string" || query.collection === "") {
    refuse("collection-missing", "A list query must name a collection.");
  }
  assertWholeNumber("limit", query.limit, 1, MAX_LIMIT);
  assertWholeNumber("offset", query.offset, 0);
  assertWholeNumber("page", query.page, 1);
  assertLocale(query.locale, binding.locale);
  for (const field of query.select ?? []) {
    assertFieldName(field, "A list's fields");
  }
}

/** The route's language binds every read on it. */
function assertLocale(
  asked: string | undefined,
  bound: string | undefined
): void {
  if (bound === undefined || asked === undefined || asked === bound) return;
  refuse(
    "locale-mismatch",
    `This page reads in "${bound}", so a list on it cannot read in "${asked}".`
  );
}

/** The fields each row carries, with its id; none named means every public one. */
function selectOf(query: PublicReadQuery): FindArgs["select"] | undefined {
  const fields = query.select ?? [];
  if (fields.length === 0) return undefined;
  return Object.fromEntries([
    ["id", true],
    ...fields.map(field => [field, true]),
  ]) as FindArgs["select"];
}

/**
 * The collection read a public list query becomes. Pure: every refusal
 * happens here, before anything is read.
 *
 * @experimental
 */
export function toPublicFind(
  query: PublicReadQuery,
  binding: PublicReaderBinding = {}
): FindArgs {
  assertPublicQuery(query, binding);
  const limit = query.limit ?? DEFAULT_LIMIT;
  // One start: core never receives both a page and an offset. Each part is a
  // safe whole number, but their sum need not be.
  const offset = (query.offset ?? 0) + ((query.page ?? 1) - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    refuse(
      "offset-invalid",
      "offset and page together start past the last row any list can reach.",
      { offset: query.offset, page: query.page, limit }
    );
  }
  const where = toWhere(query.filters);
  const select = selectOf(query);
  const locale = binding.locale ?? query.locale;
  return {
    collection: query.collection,
    ...(where === undefined ? {} : { where }),
    // Always sent, and always as keys, so a list without a sort is in id
    // order, the same on every read.
    sort: sortKeys(query.sort),
    limit,
    offset,
    ...(locale === undefined ? {} : { locale }),
    ...(select === undefined ? {} : { select }),
    // Relationships come back as ids: nothing related is read for a list.
    depth: 0,
    // The boundary, fixed: published only, the anonymous caller's rules,
    // and no key a list cannot know the meaning of.
    status: "published",
    overrideAccess: false,
    unknownSort: "refuse",
    // Every identity, present and undefined: the Direct API spreads the
    // instance's defaults underneath a call, so a key left out would let an
    // instance's own user, key scope, trust or field-rule user judge the read.
    user: undefined,
    actor: undefined,
    fieldAccessUser: undefined,
    trusted: undefined,
    req: undefined,
    request: undefined,
    context: undefined,
    showHiddenFields: false,
  } as FindArgs;
}

/** A reader bound to a route, over a Direct API's `find`.
 *
 * `find` alone, so a page route can hand over the content reader it already
 * holds: a count is a one-row read of ids whose total is the answer, under the
 * same fixed options.
 *
 * Each read runs detached from any request being served. A page rendered
 * while an API-key request is in flight must not be judged by that key: the
 * read is made by no one, so no caller's scope may narrow or widen it.
 *
 * @experimental
 */
export function createPublicReader(
  nextly: Pick<Nextly, "find">,
  binding: PublicReaderBinding = {}
): PublicReader {
  const read = (args: FindArgs) =>
    runDetachedFromRequest(() => nextly.find(args));
  return Object.freeze({
    async find(query: PublicReadQuery): Promise<PublicReadResult> {
      const result = await read(toPublicFind(query, binding));
      return { items: result.items, meta: result.meta };
    },
    async count(query: PublicCountQuery): Promise<number> {
      // Only what narrows a count: a sort, a window or a selection would be
      // judged, and could fail, for a read whose rows nobody sees.
      assertCountKeys(query);
      const result = await read(
        toPublicFind({ ...query, limit: 1, select: ["id"] }, binding)
      );
      return result.meta.total;
    },
  });
}
