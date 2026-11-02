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
import type { Nextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
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
  /** The fields each row carries, besides its id. */
  select?: readonly string[];
  /** Relationship fields to fill with their entry, one level deep. */
  populate?: readonly string[];
}

export interface PublicReadResult {
  items: Record<string, unknown>[];
  total: number;
}

/** The public reads a page's data provider is given. Nothing else.
 *
 * @experimental
 */
export interface PublicReader {
  find(query: PublicReadQuery): Promise<PublicReadResult>;
  count(
    query: Pick<PublicReadQuery, "collection" | "filters">
  ): Promise<number>;
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
  "populate",
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
  if (typeof field !== "string" || !FIELD_NAME.test(field)) {
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

/** One filter row as core's `where`, refused when it is not well formed. */
function toCondition(row: PublicFilter): Record<string, unknown> {
  assertFieldName(row.field, "A filter");
  if (!(PUBLIC_FILTER_OPS as readonly string[]).includes(row.op)) {
    refuse(
      "operator-unknown",
      `"${String(row.op)}" is not a filter operator. Use one of: ${PUBLIC_FILTER_OPS.join(", ")}.`
    );
  }
  const list = row.op === "in" || row.op === "not_in";
  const valid = list
    ? Array.isArray(row.value) && row.value.every(isScalar)
    : row.op === "exists"
      ? typeof row.value === "boolean"
      : isScalar(row.value);
  if (!valid) {
    refuse(
      "value-invalid",
      `The value for "${row.field}" ${row.op} must be ${list ? "a list of values" : row.op === "exists" ? "true or false" : "one value"}.`
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
  if (typeof query.collection !== "string" || query.collection === "") {
    refuse("collection-missing", "A list query must name a collection.");
  }
  assertWholeNumber("limit", query.limit, 1, MAX_LIMIT);
  assertWholeNumber("offset", query.offset, 0);
  assertWholeNumber("page", query.page, 1);
  assertLocale(query.locale, binding.locale);
  for (const field of [...(query.select ?? []), ...(query.populate ?? [])]) {
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
  const fields = [...(query.select ?? []), ...(query.populate ?? [])];
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
  const where = toWhere(query.filters);
  const select = selectOf(query);
  const locale = binding.locale ?? query.locale;
  return {
    collection: query.collection,
    ...(where === undefined ? {} : { where }),
    // Always sent, so a list without a sort is in id order, the same on
    // every read.
    sort: typeof query.sort === "string" ? query.sort : [...(query.sort ?? [])],
    limit,
    // One start: core never receives both a page and an offset.
    offset: (query.offset ?? 0) + ((query.page ?? 1) - 1) * limit,
    ...(locale === undefined ? {} : { locale }),
    ...(select === undefined ? {} : { select }),
    depth: (query.populate?.length ?? 0) > 0 ? 1 : 0,
    // The boundary, fixed: published only, the anonymous caller's rules,
    // and no key a list cannot know the meaning of.
    status: "published",
    overrideAccess: false,
    user: undefined,
    unknownSort: "refuse",
  } as FindArgs;
}

/** A reader bound to a route, over a Direct API that answers its two reads.
 *
 * @experimental
 */
export function createPublicReader(
  nextly: Pick<Nextly, "find" | "count">,
  binding: PublicReaderBinding = {}
): PublicReader {
  return Object.freeze({
    async find(query: PublicReadQuery): Promise<PublicReadResult> {
      const result = await nextly.find(toPublicFind(query, binding));
      return {
        items: result.items,
        total: result.meta.total,
      };
    },
    async count(
      query: Pick<PublicReadQuery, "collection" | "filters">
    ): Promise<number> {
      const args = toPublicFind({ ...query, limit: 1 }, binding);
      const counted = await nextly.count({
        collection: args.collection,
        ...(args.where === undefined ? {} : { where: args.where }),
        status: "published",
        overrideAccess: false,
        user: undefined,
        ...(args.locale === undefined ? {} : { locale: args.locale }),
      });
      return counted.total;
    },
  });
}
