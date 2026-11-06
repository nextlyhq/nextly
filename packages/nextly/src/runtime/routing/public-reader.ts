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
 * A Single a page shows is read through the same boundary: published, judged
 * as the anonymous caller, with the same refusals, and never created by the
 * read.
 *
 * This is a contract a page builder relies on, not a sandbox: code that holds
 * the Direct API can still read whatever it is trusted to.
 *
 * @module runtime/routing/public-reader
 */
import { z } from "zod";

import type { Nextly } from "../../direct-api/nextly";
import type { FindArgs } from "../../direct-api/types/collections";
import type { ListResult } from "../../direct-api/types/shared";
import type { FindSingleArgs } from "../../direct-api/types/singles";
import { filterShapeProblems } from "../../domains/collections/query/filter-shape";
import { NextlyError } from "../../errors/nextly-error";

import { isMissOrDenied } from "./miss-or-denied";
import { readAsVisitor } from "./read-as-visitor";

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

/**
 * What a page reads of one Single. Everything else a read could say is the
 * reader's to fix, as for a list.
 *
 * @experimental
 */
export interface PublicSingleQuery {
  slug: string;
  /** The route's language; a different one is refused. */
  locale?: string;
  /**
   * The fields the document carries, besides its id; none named means every
   * public one. A relationship comes back as the related id.
   */
  select?: readonly string[];
}

/** One Single's document as the public sees it, or `null` when there is none to see. */
export type PublicSingleResult = Record<string, unknown> | null;

/** The public reads a page's data provider is given. Nothing else.
 *
 * @experimental
 */
export interface PublicReader {
  find(query: PublicReadQuery): Promise<PublicReadResult>;
  count(query: PublicCountQuery): Promise<number>;
}

/**
 * The public reader with a Single's read beside the lists'. A separate
 * interface, so a reader written against {@link PublicReader}'s two reads
 * still is one.
 *
 * @experimental
 */
export interface PublicSourceReader extends PublicReader {
  /**
   * One Single, published, with the fields the public may read. `null` when
   * there is nothing a visitor may see: no document, one never published, or
   * a Single the visitor may not read, all answered alike so the answer does
   * not tell them apart. It never creates the Single's document.
   */
  findSingle(query: PublicSingleQuery): Promise<PublicSingleResult>;
}

/** What a route binds the reader to. */
export interface PublicReaderBinding {
  /** The route's language. Every read answers in it. */
  locale?: string;
  /**
   * Where the reader learns which fields each source declares hidden, for a
   * reader over something other than this process's Nextly: a test's
   * stand-in, or a source whose schema the registry does not hold. Absent,
   * the registered schema answers, and a read whose schema cannot be read is
   * refused rather than returned unstripped.
   *
   * @experimental
   */
  declarations?: PublicReaderDeclarations;
}

/** A collection's entries or one Single, by slug. */
export interface PublicSource {
  kind: "collection" | "single";
  slug: string;
}

/**
 * The hidden fields of each source a reader reads, as dotted paths (`secret`,
 * `seo.apiKey`, `rows.token`); none is an empty list, which says the source
 * hides nothing.
 *
 * @experimental
 */
export interface PublicReaderDeclarations {
  hiddenFields(
    source: PublicSource
  ): readonly string[] | Promise<readonly string[]>;
}

const HIDDEN_PATHS = z.array(z.string());

/**
 * The Direct API reads a public reader is made over. `findSingle` is
 * optional so a route that hands over only `find` keeps working; such a
 * reader refuses a Single's read.
 *
 * @experimental
 */
export type PublicReaderSource = Pick<Nextly, "find"> &
  Partial<Pick<Nextly, "findSingle">>;

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

export function refuse(
  reason: string,
  message: string,
  detail: object = {}
): never {
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

/**
 * A Single's read, derived from a list's: the same language and selection,
 * typed the same, and a slug in place of the collection.
 */
const SINGLE_SHAPE = QUERY_SHAPE.pick({ locale: true, select: true }).extend({
  slug: z.string(),
});

/** The keys a Single's read may set: those of its shape, and no other. */
const SINGLE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(SINGLE_SHAPE.shape)
);

function assertShape(
  query: object,
  shape: z.ZodType = QUERY_SHAPE,
  what = "A list query"
): void {
  const parsed = shape.safeParse(query);
  if (parsed.success) return;
  const issue = parsed.error.issues[0];
  const where = issue?.path.map(String).join(".") || "the query";
  refuse(
    "query-invalid",
    `${what}'s ${where} is not of the type it takes: ${issue?.message ?? "invalid"}.`,
    { path: where }
  );
}

/**
 * The sort keys, each trimmed, empty ones dropped. A string is split on
 * commas, as core splits one, so `""`, `" "` and `","` come to no keys and
 * the read keeps its id order instead of reaching core with no order at all.
 */
export function sortKeys(
  sort: string | readonly string[] | undefined
): string[] {
  // Every element split on commas, as core splits each one, so the keys
  // judged here are the keys core would order by.
  const parts = (typeof sort === "string" ? [sort] : [...(sort ?? [])]).flatMap(
    part => part.split(",")
  );
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

/**
 * Refuse every key of `query` outside `allowed`, naming each: one refusal
 * for the list, the count and the Single's reads, each saying it in its own
 * words through `sentence`.
 */
function assertKnownKeys(
  query: object,
  allowed: ReadonlySet<string>,
  sentence: (named: string) => string
): void {
  const extra = Object.keys(query).filter(key => !allowed.has(key));
  if (extra.length > 0) {
    refuse(
      "option-refused",
      sentence(extra.map(key => `"${key}"`).join(", ")),
      { keys: extra }
    );
  }
}

export function assertCountKeys(query: object): void {
  if (query === null || typeof query !== "object") {
    refuse("query-invalid", "A count query must be an object.");
  }
  assertKnownKeys(
    query,
    COUNT_KEYS,
    named =>
      `A public count takes a collection, filters and a language only, not ${named}.`
  );
}

function assertQueryKeys(query: object): void {
  assertKnownKeys(
    query,
    QUERY_KEYS,
    named =>
      `A public list cannot set ${named}: a page shows published entries and public fields only, to everyone.`
  );
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

/** One filter row as core's `where`, refused when it is not well formed. */
function toCondition(row: PublicFilter): Record<string, unknown> {
  assertFieldName(row.field, "A filter");
  if (!(PUBLIC_FILTER_OPS as readonly string[]).includes(row.op)) {
    refuse(
      "operator-unknown",
      `"${String(row.op)}" is not a filter operator. Use one of: ${PUBLIC_FILTER_OPS.join(", ")}.`
    );
  }
  const condition = { [row.field]: { [CORE_OP[row.op]]: row.value } };
  // Judged by core's own table of what each operator takes, so the reader
  // cannot accept a value that `find` then refuses, or refuse one it reads.
  const [problem] = filterShapeProblems(condition);
  if (problem !== undefined) {
    refuse(
      "value-invalid",
      `The value for "${row.field}" ${row.op} is not one it takes: ${problem.message}`
    );
  }
  return condition;
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
  bound: string | undefined,
  what = "a list"
): void {
  if (bound === undefined || asked === undefined || asked === bound) return;
  refuse(
    "locale-mismatch",
    `This page reads in "${bound}", so ${what} on it cannot read in "${asked}".`
  );
}

/**
 * What decides who sees what on every public read, fixed: published only,
 * judged by the anonymous caller's rules, with nothing related read.
 *
 * Every identity is present and undefined: the Direct API spreads the
 * instance's defaults underneath a call, so a key left out would let an
 * instance's own user, key scope, trust or field-rule user judge the read.
 * One object for the list's read and the Single's, so the two cannot drift.
 */
const PUBLIC_BOUNDARY = {
  // Relationships come back as ids: nothing related is read.
  depth: 0,
  status: "published",
  overrideAccess: false,
  user: undefined,
  actor: undefined,
  fieldAccessUser: undefined,
  trusted: undefined,
  req: undefined,
  request: undefined,
  context: undefined,
  showHiddenFields: false,
} as const;

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
    ...PUBLIC_BOUNDARY,
    // No key a list cannot know the meaning of.
    unknownSort: "refuse",
  } as FindArgs;
}

/** Refuse a Single's read a public page may not make, before anything is read. */
function assertPublicSingleQuery(
  query: PublicSingleQuery,
  binding: PublicReaderBinding
): void {
  if (query === null || typeof query !== "object") {
    refuse("query-invalid", "A Single query must be an object.");
  }
  assertKnownKeys(
    query,
    SINGLE_KEYS,
    named =>
      `A public Single read cannot set ${named}: a page shows published content and public fields only, to everyone.`
  );
  assertShape(query, SINGLE_SHAPE, "A Single query");
  if (query.slug === "") {
    refuse("single-missing", "A Single query must name a Single.");
  }
  assertLocale(query.locale, binding.locale, "a Single");
  for (const field of query.select ?? []) {
    assertFieldName(field, "A Single's fields");
  }
}

/**
 * The Single read a public Single query becomes. Pure: every refusal happens
 * here, before anything is read. A Single with no document answers `null`
 * rather than having one created: a page read must not write.
 *
 * @experimental
 */
export function toPublicFindSingle(
  query: PublicSingleQuery,
  binding: PublicReaderBinding = {}
): FindSingleArgs & { createIfMissing: false } {
  assertPublicSingleQuery(query, binding);
  const locale = binding.locale ?? query.locale;
  return {
    slug: query.slug,
    ...(locale === undefined ? {} : { locale }),
    createIfMissing: false,
    ...PUBLIC_BOUNDARY,
  };
}

/**
 * The document narrowed to its id and the fields named. A Single's read
 * returns the whole document, so the selection is kept here; a field the
 * read left out stays out.
 */
function selectedFrom(
  document: Record<string, unknown>,
  select: readonly string[] | undefined
): Record<string, unknown> {
  if (select === undefined || select.length === 0) return document;
  const kept = new Set(["id", ...select]);
  return Object.fromEntries(
    Object.entries(document).filter(([key]) => kept.has(key))
  );
}

/**
 * The hidden fields of a source: from the declarations the route supplied,
 * else from the registered schema, which refuses when it cannot be read.
 *
 * Asked after the read, never before it: a reader made lazily boots the
 * instance on its first read, and asked earlier the registry would not be
 * there to answer for that read.
 */
export async function hiddenOf(
  binding: PublicReaderBinding,
  source: PublicSource
): Promise<ReadonlySet<string>> {
  if (binding.declarations !== undefined) {
    const declared = HIDDEN_PATHS.safeParse(
      await binding.declarations.hiddenFields(source)
    );
    if (!declared.success) {
      throw NextlyError.configuration({
        logMessage:
          "A public reader's declarations answered hidden fields that are not a list of field paths.",
        logContext: { reason: "public-read-declarations-invalid" },
      });
    }
    return new Set(declared.data);
  }
  const { hiddenFieldPaths } = await import("./declared-fields");
  return hiddenFieldPaths(source);
}

/**
 * Refuse a filter or a sort naming a hidden field, before anything read is
 * returned: the rows a filter keeps, and the order a sort puts them in, would
 * reveal the value every row is stripped of.
 */
export function assertNotHidden(
  query: Pick<PublicReadQuery, "filters" | "sort">,
  hidden: ReadonlySet<string>
): void {
  if (hidden.size === 0) return;
  const named = [
    ...(query.filters ?? []).map(row => row.field),
    ...sortKeys(query.sort).map(key => key.replace(/^-/, "")),
  ];
  const refused = [...new Set(named.filter(name => hidden.has(name)))].sort();
  if (refused.length > 0) {
    refuse(
      "field-hidden",
      `A public list cannot filter or sort by ${refused.map(name => `"${name}"`).join(", ")}: the field is hidden, so no row shows it.`,
      { fields: refused }
    );
  }
}

/** A row or a document without its hidden fields. */
async function withoutHiddenFields(
  document: Record<string, unknown>,
  hidden: ReadonlySet<string>
): Promise<Record<string, unknown>> {
  if (hidden.size === 0) return document;
  const { withoutHidden } = await import("./declared-fields");
  return withoutHidden(document, hidden);
}

/** A reader bound to a route, over a Direct API's `find` and `findSingle`.
 *
 * `find` alone is enough for lists, so a page route can hand over the content
 * reader it already holds: a count is a one-row read of ids whose total is the
 * answer, under the same fixed options. A Single's read needs `findSingle`.
 *
 * A field declared hidden never comes back, and a list may not filter or sort
 * on one, by core's sensitive-field rule; the Direct API returns such a field
 * to any caller its field rules allow.
 *
 * Each read runs as no one: detached from any request being served and from
 * any person the operation around it is made as. A page rendered while an
 * API-key request is in flight, or inside a plugin person's operation, must
 * not be judged by that key or that person, so neither may narrow or widen it.
 *
 * @experimental
 */
export function createPublicReader(
  nextly: PublicReaderSource,
  binding: PublicReaderBinding = {}
): PublicSourceReader {
  const read = (args: FindArgs) => readAsVisitor(() => nextly.find(args));
  return Object.freeze({
    async find(query: PublicReadQuery): Promise<PublicReadResult> {
      const args = toPublicFind(query, binding);
      const result = await read(args);
      // Judged once the read has booted the instance, and before any of its
      // rows or its total is returned.
      const hidden = await hiddenOf(binding, {
        kind: "collection",
        slug: query.collection,
      });
      assertNotHidden(query, hidden);
      return {
        items: await Promise.all(
          result.items.map(item => withoutHiddenFields(item, hidden))
        ),
        meta: result.meta,
      };
    },
    async count(query: PublicCountQuery): Promise<number> {
      // Only what narrows a count: a sort, a window or a selection would be
      // judged, and could fail, for a read whose rows nobody sees.
      assertCountKeys(query);
      const args = toPublicFind(
        { ...query, limit: 1, select: ["id"] },
        binding
      );
      const result = await read(args);
      assertNotHidden(
        query,
        await hiddenOf(binding, { kind: "collection", slug: query.collection })
      );
      return result.meta.total;
    },
    async findSingle(query: PublicSingleQuery): Promise<PublicSingleResult> {
      const args = toPublicFindSingle(query, binding);
      const findSingle = nextly.findSingle;
      if (findSingle === undefined) {
        throw NextlyError.configuration({
          logMessage:
            "This public reader was made over a reader with no findSingle, so it cannot read a Single.",
          logContext: { reason: "public-read-single-unsupported" },
        });
      }
      // The Single route's answer: missing, unpublished and refused all read
      // as nothing here, so the result does not tell them apart. Only the
      // read itself is judged so, whether its source throws or rejects: a
      // failure after it, such as the hidden-field declarations refusing, is
      // not a miss and throws as it does from `find` and `count`.
      const document = await (async () => {
        try {
          return await readAsVisitor(() => findSingle.call(nextly, args));
        } catch (error) {
          if (isMissOrDenied(error)) return null;
          throw error;
        }
      })();
      if (document === null) return null;
      const hidden = await hiddenOf(binding, {
        kind: "single",
        slug: query.slug,
      });
      return selectedFrom(
        await withoutHiddenFields(document, hidden),
        query.select
      );
    },
  });
}
