/**
 * How a collection list reads its entries: its stored query turned into the
 * reads the page's data source answers, and what to tell an author when the
 * read could not be made as stored.
 *
 * The stored query is read by the engine's `readListQuery`, the same reading
 * the validator judges a save with. What is decided here is what only a read
 * can decide:
 *
 * - **Filters** go to the reader as typed rows. A date filter stores the day
 *   an author picked, and compares whole days: in the site's time zone for a
 *   field holding an instant, and as the day itself for a field holding a
 *   calendar day, which is stored without a zone.
 * - **Sort** goes as the stored keys; the reader adds the id as the last key
 *   and puts empty values last in either direction. A stored sort the reader
 *   refuses (a field since removed, one visitors may not read) is dropped,
 *   and the list is read once more in id order and reported.
 * - **A related source** reads the ids the page's entry or the outer item
 *   holds as a visitor reads them, with an `in` row: the entry is read again
 *   through the list's source, and a relation the public may not read lists
 *   nothing. With no sort, the entries keep the order the
 *   relation stores them in, which is reordered here because a database
 *   returns an `in` read in its own order; filters, the offset and the limit
 *   still apply, in that order. A sort, when one is set, wins.
 *
 * @module blocks/list-read
 */
import {
  readListQuery,
  safeTimeZone,
  isListDay,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  type ListFilter,
  type ListFilterOp,
  type ListQuery,
  type ListRelation,
} from "@nextlyhq/blocks-engine";

import type {
  BlocksFilter,
  BlocksFilterOp,
  BlocksQuery,
  PageContext,
} from "../context";

/** How many entries a list shows when it stores no limit. */
const DEFAULT_LIMIT = 10;

/** How many ids one related read asks for: the reader's own page cap. */
const RELATED_READ_SIZE = LIST_LIMIT_MAX;

/** The reader's spelling of each stored operator. */
const READER_OP: Readonly<Record<ListFilterOp, BlocksFilterOp>> = {
  equals: "equals",
  not_equals: "not_equals",
  greater_than: "gt",
  greater_than_equal: "gte",
  less_than: "lt",
  less_than_equal: "lte",
  contains: "contains",
  in: "in",
  not_in: "not_in",
  exists: "exists",
};

/**
 * What an author is told about a list's read, in the editor and preview
 * only: a sort that fell back to id order, or a read that failed.
 */
export interface ListDiagnostic {
  readonly kind: "sort-fallback" | "query-failed";
  readonly message: string;
}

/** What a list's read came to: the entries, and anything worth telling. */
export interface ListOutcome {
  readonly items: readonly Record<string, unknown>[];
  /** True when the read could not be made; the empty state is drawn. */
  readonly failed: boolean;
  readonly diagnostic?: ListDiagnostic;
}

/**
 * The number of entries to ask for. A stored limit outside the bounds was
 * written before they were checked at save, so it is held to them rather
 * than refused, as it always was.
 */
function safeLimit(limit: unknown): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(LIST_LIMIT_MAX, Math.max(LIST_LIMIT_MIN, Math.floor(limit)));
}

/** `zone`'s wall clock at `instant`, read as if it were UTC, to the second. */
function wallClock(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(candidate => candidate.type === type)?.value ?? 0);
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second")
  );
}

/** How far `zone`'s wall clock is ahead of UTC at `instant`, in milliseconds. */
function zoneOffset(instant: number, zone: string): number {
  return wallClock(instant, zone) - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant a day starts in a time zone, as an ISO string: the earliest
 * instant whose wall-clock date in the zone is that day.
 *
 * Two candidates: midnight at the offset UTC's midnight has, and midnight at
 * the offset that candidate has. They differ only when the clocks change near
 * midnight, and then the earlier one that still falls on the day is its
 * start. A zone that changes its clocks AT midnight skips it (the day starts
 * at 01:00) or repeats the hour before it (the day starts at the second
 * midnight), and neither candidate alone is right for both.
 */
export function dayStartIn(day: string, zone: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const midnight = Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1);
  const first = midnight - zoneOffset(midnight, zone);
  const second = midnight - zoneOffset(first, zone);
  const onTheDay = [first, second].filter(
    instant =>
      new Date(wallClock(instant, zone)).toISOString().slice(0, 10) === day
  );
  return new Date(
    onTheDay.length === 0 ? first : Math.min(...onTheDay)
  ).toISOString();
}

/** The day after a `YYYY-MM-DD` day. */
function nextDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + 1))
    .toISOString()
    .slice(0, 10);
}

/**
 * A day filter as a comparison of instants: "after the 1st" is "from the
 * start of the 2nd", "on or before the 1st" is "before the start of the 2nd",
 * so a value on the day itself, at any time, falls where an author means.
 */
function dayRow(
  row: ListFilter & { readonly value: string },
  zone: string
): BlocksFilter {
  switch (row.op) {
    case "greater_than":
      return {
        field: row.field,
        op: "gte",
        value: dayStartIn(nextDay(row.value), zone),
      };
    case "greater_than_equal":
      return {
        field: row.field,
        op: "gte",
        value: dayStartIn(row.value, zone),
      };
    case "less_than":
      return { field: row.field, op: "lt", value: dayStartIn(row.value, zone) };
    default:
      return {
        field: row.field,
        op: "lt",
        value: dayStartIn(nextDay(row.value), zone),
      };
  }
}

/** Whether an operator compares an order, which a day filter does. */
function comparesOrder(op: ListFilterOp): boolean {
  return (
    op === "greater_than" ||
    op === "greater_than_equal" ||
    op === "less_than" ||
    op === "less_than_equal"
  );
}

/**
 * The zone a day on `field` is compared in: none for a field holding a
 * calendar day, which is stored as that day; the site's for an instant, and
 * for a field whose shape is not known.
 */
function dayZoneOf(
  field: string,
  collection: string,
  ctx: Pick<PageContext, "timeZone" | "fieldShapes">
): string {
  const shape = ctx.fieldShapes
    ?.fieldsOf({ collection })
    ?.find(candidate => candidate.name === field);
  if (shape?.dateOnly === true) return "UTC";
  return safeTimeZone(ctx.timeZone).zone;
}

/** The stored filter rows as the reader takes them. */
function readerFilters(
  filters: readonly ListFilter[],
  collection: string,
  ctx: Pick<PageContext, "timeZone" | "fieldShapes">
): BlocksFilter[] {
  return filters.map(row =>
    comparesOrder(row.op) && isListDay(row.value)
      ? dayRow(
          { ...row, value: row.value },
          dayZoneOf(row.field, collection, ctx)
        )
      : { field: row.field, op: READER_OP[row.op], value: row.value }
  );
}

/** The id one related value names: an id, or an entry read in its place. */
function idOf(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = (value as { id: unknown }).id;
    if (typeof id === "string" || typeof id === "number") return id;
  }
  return undefined;
}

/** The ids a stored relation value names, in its stored order, each once. */
function idsIn(stored: unknown): (string | number)[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const ids: (string | number)[] = [];
  for (const value of stored) {
    const id = idOf(value);
    if (id === undefined || seen.has(String(id))) continue;
    seen.add(String(id));
    ids.push(id);
  }
  return ids;
}

/** A related source's ids as a visitor reads them, or why there are none. */
type RelatedIds =
  | { readonly ids: readonly (string | number)[] }
  | { readonly problem: string };

/**
 * The ids a related source holds, as the public reads its holder.
 *
 * The page's entry is read again, by id and with only the relation field,
 * through the list's own source: the route's `entry` may hold more than a
 * visitor may read, and a relation hidden from the public must not decide
 * which entries show, or in what order. The read is claimed from the page's
 * allowance like any other. A field missing from the public's row is one
 * visitors may not read, which lists nothing.
 *
 * The outer item is not read again: the outer list read its rows through this
 * same source with no selection, so each already holds every field the public
 * may read and nothing else, and a second read would ask the same question.
 */
async function relatedIds(
  relation: ListRelation,
  ctx: PageContext,
  reads: ListReads
): Promise<RelatedIds> {
  if (relation.of === "item") {
    return ctx.item === undefined
      ? {
          problem:
            "This list is not inside another list, so it has no item whose related entries to list.",
        }
      : { ids: idsIn(ctx.item[relation.field]) };
  }
  return await entryRelatedIds(relation.field, ctx, reads);
}

/**
 * The ids the page's entry holds in `field`, read again as the public reads
 * the entry: by id, with only that field, claimed from the page's allowance.
 */
async function entryRelatedIds(
  field: string,
  ctx: PageContext,
  reads: ListReads
): Promise<RelatedIds> {
  if (ctx.entry === null) {
    return {
      problem:
        "This page shows no entry, so it has no related entries to list.",
    };
  }
  const id = ctx.entry.id;
  const collection = ctx.entryCollection;
  if (
    collection === undefined ||
    (typeof id !== "string" && typeof id !== "number")
  ) {
    return {
      problem:
        "This page's entry is not one visitors read from a collection, so it has no related entries to list.",
    };
  }
  if (!reads.claim()) {
    return {
      problem:
        "This page has used up the reads it may make, so this list's related entries were not read.",
    };
  }
  const [row] = await reads.find({
    collection,
    filters: [{ field: "id", op: "equals", value: id }],
    select: [field],
    limit: 1,
    ...(ctx.locale === undefined ? {} : { locale: ctx.locale }),
  });
  if (row === undefined) {
    return {
      problem:
        "Visitors can't read this page's entry, so it has no related entries to list.",
    };
  }
  // The reader leaves out a field the public may not read.
  if (!(field in row)) {
    return {
      problem: `Visitors can't read "${field}" on ${collection}, so this list has no related entries to show them.`,
    };
  }
  return { ids: idsIn(row[field]) };
}

/** Whether a read failed because the reader refused it, before or as it read. */
function readWasRefused(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "INVALID_INPUT") return true;
  const errors = (error as { publicData?: { errors?: unknown } } | null)
    ?.publicData?.errors;
  return (
    Array.isArray(errors) &&
    errors.length > 0 &&
    errors.every(
      problem =>
        (problem as { code?: unknown } | null)?.code === "FIELD_NOT_SORTABLE"
    )
  );
}

/** The sort keys a refusal names, when it names them. */
function refusedSortFields(error: unknown): string[] {
  const errors = (error as { publicData?: { errors?: unknown } } | null)
    ?.publicData?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap(problem => {
    const path = (problem as { path?: unknown } | null)?.path;
    return typeof path === "string" && path.startsWith("sort.")
      ? [path.slice("sort.".length)]
      : [];
  });
}

/** The words for a sort that fell back to id order. */
function sortFallback(
  fields: readonly string[],
  collection: string
): ListDiagnostic {
  const named = fields.map(field => `"${field}"`).join(", ");
  return {
    kind: "sort-fallback",
    message: `This list's sort names ${named}, which ${collection} no longer has or visitors can't see. It shows entries in ID order.`,
  };
}

/** The reads one list makes, bound to its data source, language and budget. */
interface ListReads {
  readonly find: (
    query: BlocksQuery
  ) => Promise<readonly Record<string, unknown>[]>;
  /** Claim one more read; false when the page has spent its allowance. */
  readonly claim: () => boolean;
}

/**
 * A sorted read, and the same read in id order when the reader refused the
 * stored sort. The first read is claimed by the caller; a retry after a
 * refusal made before reading costs no second claim, and one made after
 * reading (a hidden field, which the reader judges once it has read) claims
 * its own.
 */
async function readSorted(
  reads: ListReads,
  query: BlocksQuery,
  sort: readonly string[],
  collection: string
): Promise<{
  items: readonly Record<string, unknown>[];
  diagnostic?: ListDiagnostic;
}> {
  if (sort.length === 0)
    return { items: await reads.find({ ...query, sort: [] }) };
  try {
    return { items: await reads.find({ ...query, sort: sort.join(",") }) };
  } catch (error) {
    if (!readWasRefused(error)) throw error;
    const named = refusedSortFields(error);
    if (named.length === 0 && !reads.claim()) throw error;
    return {
      items: await reads.find({ ...query, sort: [] }),
      diagnostic: sortFallback(
        named.length > 0 ? named : sort.map(key => key.replace(/^-/, "")),
        collection
      ),
    };
  }
}

/** The stored keys as the reader takes them. */
function sortTexts(query: ListQuery): string[] {
  return query.sort.map(key => (key.descending ? `-${key.field}` : key.field));
}

/**
 * The entries of a related source with no sort, in the relation's stored
 * order. The ids are read a page at a time, in that order, until the window
 * the offset and limit cut is filled, so a relation longer than one read
 * still shows the right entries; each read after the first is claimed.
 */
async function readInStoredOrder(
  reads: ListReads,
  base: BlocksQuery,
  ids: readonly (string | number)[],
  window: { readonly offset: number; readonly limit: number }
): Promise<readonly Record<string, unknown>[]> {
  const kept: Record<string, unknown>[] = [];
  const wanted = window.offset + window.limit;
  for (let start = 0; start < ids.length && kept.length < wanted; ) {
    if (start > 0 && !reads.claim()) break;
    const chunk = ids.slice(start, start + RELATED_READ_SIZE);
    const found = await reads.find({
      ...base,
      filters: [
        ...(base.filters ?? []),
        { field: "id", op: "in", value: chunk },
      ],
      sort: [],
      limit: RELATED_READ_SIZE,
    });
    const byId = new Map(found.map(item => [String(item.id), item]));
    for (const id of chunk) {
      const item = byId.get(String(id));
      if (item !== undefined) kept.push(item);
    }
    start += RELATED_READ_SIZE;
  }
  return kept.slice(window.offset, wanted);
}

/** Why a stored query cannot be read as stored, beyond its limit and sort. */
function blockingProblem(
  problems: ReturnType<typeof readListQuery>["problems"]
): string | undefined {
  // A limit is held to its bounds and a malformed sort lists in id order,
  // as a stored list always did; anything else would read the wrong entries.
  const blocking = problems.filter(
    problem => problem.prop !== "limit" && problem.prop !== "sort"
  );
  return blocking.length === 0
    ? undefined
    : blocking.map(problem => problem.message).join(" ");
}

/** The words for a read that failed, with what failed when it is known. */
function failure(detail: string | undefined): ListDiagnostic {
  return {
    kind: "query-failed",
    message: `This list couldn't load its entries, so visitors see its empty state.${detail === undefined ? "" : ` ${detail}`}`,
  };
}

/** What a failed read's error says, when it says something an author can use. */
function errorDetail(error: unknown): string | undefined {
  const message = error as {
    publicMessage?: unknown;
    message?: unknown;
  } | null;
  const text = message?.publicMessage ?? message?.message;
  return typeof text === "string" && text !== "" ? text : undefined;
}

/**
 * A stored list's read before its source is read: its query as the engine
 * reads it, and the reader's base query with its window. One reading, so the
 * list's read and the editor's count of it cannot drift apart.
 */
function listReadBase(
  props: unknown,
  collection: string,
  ctx: Pick<PageContext, "locale" | "timeZone" | "fieldShapes">
):
  | { readonly blocking: string }
  | {
      readonly query: ListQuery;
      readonly problems: ReturnType<typeof readListQuery>["problems"];
      readonly base: BlocksQuery;
      readonly offset: number;
      readonly limit: number;
    } {
  const { query, problems } = readListQuery(props);
  const blocking = blockingProblem(problems);
  if (blocking !== undefined) return { blocking };
  const limit = safeLimit((props as { limit?: unknown } | null)?.limit);
  const offset = query.offset ?? 0;
  const filters = readerFilters(query.filters, collection, ctx);
  const base: BlocksQuery = {
    collection,
    limit,
    ...(filters.length === 0 ? {} : { filters }),
    ...(offset === 0 ? {} : { offset }),
    ...(ctx.locale === undefined ? {} : { locale: ctx.locale }),
  };
  return { query, problems, base, offset, limit };
}

/**
 * The one read that counts a list's matching entries, and the window it
 * shows them through, for the editor to say "N entries match, so M show".
 *
 * The count's query is the list's own read less its sort and window, so it
 * counts exactly the entries the list chooses from, as a visitor reads them.
 * Undefined where one read cannot answer it: no collection named; a query
 * that cannot be read as stored; and a related source, whose ids are read
 * from the entry or the outer item first.
 *
 * @experimental
 */
export interface ListCountRead {
  readonly query: Pick<BlocksQuery, "collection" | "filters" | "locale">;
  readonly offset: number;
  readonly limit: number;
}

/** A stored list's count read: see {@link ListCountRead}. @experimental */
export function listCountRead(
  props: unknown,
  ctx: Pick<PageContext, "locale" | "timeZone" | "fieldShapes">
): ListCountRead | undefined {
  const named = readListQuery(props).query;
  if (named.collection === undefined || named.relation !== undefined) {
    return undefined;
  }
  const read = listReadBase(props, named.collection, ctx);
  if ("blocking" in read) return undefined;
  return {
    query: {
      collection: read.base.collection,
      ...(read.base.filters === undefined
        ? {}
        : { filters: read.base.filters }),
      ...(read.base.locale === undefined ? {} : { locale: read.base.locale }),
    },
    offset: read.offset,
    limit: read.limit,
  };
}

/**
 * How many of `matching` entries a list shows: those after the skipped ones,
 * up to its limit, and never fewer than none. @experimental
 */
export function listShownOf(
  matching: number,
  window: Pick<ListCountRead, "offset" | "limit">
): number {
  return Math.max(0, Math.min(matching - window.offset, window.limit));
}

/**
 * Read a list's entries as its stored props ask. Never throws: a read that
 * fails comes back as `failed` with what failed, and the list draws its
 * empty state.
 */
export async function readList(
  props: unknown,
  collection: string,
  ctx: PageContext,
  reads: ListReads
): Promise<ListOutcome> {
  const read = listReadBase(props, collection, ctx);
  if ("blocking" in read) {
    return { items: [], failed: true, diagnostic: failure(read.blocking) };
  }
  const { query, problems, base, offset, limit } = read;
  const sortProblem = problems.find(problem => problem.prop === "sort");
  const sort = sortProblem === undefined ? sortTexts(query) : [];
  try {
    // A related source's ids first, as a visitor reads them; with none to
    // read, the list draws its empty state and an author is told why.
    const related =
      query.relation === undefined
        ? undefined
        : await relatedIds(query.relation, ctx, reads);
    if (related !== undefined && "problem" in related) {
      return { items: [], failed: true, diagnostic: failure(related.problem) };
    }
    const read = await readSource(base, sort, related?.ids, reads, {
      offset,
      limit,
    });
    const diagnostic =
      read.diagnostic ??
      (sortProblem === undefined
        ? undefined
        : { kind: "sort-fallback" as const, message: sortProblem.message });
    return {
      items: read.items,
      failed: false,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  } catch (error) {
    return { items: [], failed: true, diagnostic: failure(errorDetail(error)) };
  }
}

/**
 * Read from the list's source: its collection, or, when `ids` is given, the
 * related entries those ids name.
 */
async function readSource(
  base: BlocksQuery,
  sort: readonly string[],
  ids: readonly (string | number)[] | undefined,
  reads: ListReads,
  window: { readonly offset: number; readonly limit: number }
): Promise<{
  items: readonly Record<string, unknown>[];
  diagnostic?: ListDiagnostic;
}> {
  if (ids === undefined) {
    return readSorted(reads, base, sort, base.collection);
  }
  if (ids.length === 0) return { items: [] };
  if (sort.length === 0) {
    const { offset: _offset, ...unwindowed } = base;
    return { items: await readInStoredOrder(reads, unwindowed, ids, window) };
  }
  return readSorted(
    reads,
    {
      ...base,
      filters: [...(base.filters ?? []), { field: "id", op: "in", value: ids }],
    },
    sort,
    base.collection
  );
}
