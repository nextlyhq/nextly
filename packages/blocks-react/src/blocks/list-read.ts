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
  listFieldKind,
  listPageCount,
  readListQuery,
  safeTimeZone,
  isListDay,
  listDayAfter,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  type BindingFieldShape,
  type ConditionDayStart,
  type ListFilter,
  type ListFilterOp,
  type ListQuery,
  type ListRelation,
} from "@nextlyhq/blocks-engine";

import type {
  BlocksDataProvider,
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
        value: dayStartIn(listDayAfter(row.value), zone),
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
        value: dayStartIn(listDayAfter(row.value), zone),
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
 * The zone a day on `field` is compared in, or `undefined` when the field
 * is known not to hold a date, whose day-shaped value is compared as
 * stored: none for a field holding a calendar day, which is stored as that
 * day; the site's for an instant, and for a field whose shape is not known.
 * The save refuses an order on a field of another kind, so this guards a
 * stored row only.
 */
function dayZoneOf(
  field: string,
  collection: string,
  ctx: Pick<PageContext, "timeZone" | "fieldShapes">
): string | undefined {
  const shape = ctx.fieldShapes
    ?.fieldsOf({ collection })
    ?.find(candidate => candidate.name === field);
  if (shape !== undefined && listFieldKind(shape) !== "date") return undefined;
  return zoneOfDay(shape, ctx.timeZone);
}

/**
 * The zone a day on a field is compared in: none for a field holding a
 * calendar day, which is stored as that day, so UTC; the site's for an
 * instant, and for a field whose shape is not known. The one rule, for a
 * list's day filter and a block's day condition alike.
 */
function zoneOfDay(
  shape: BindingFieldShape | undefined,
  timeZone: string | undefined
): string {
  if (shape?.dateOnly === true) return "UTC";
  return safeTimeZone(timeZone).zone;
}

/**
 * When a day starts for a block's visibility condition on a date field, in
 * the zone a list's day filter would compare it in.
 *
 * @experimental
 */
export function conditionDayStart(
  timeZone: string | undefined
): ConditionDayStart {
  return (day, field) =>
    Date.parse(dayStartIn(day, zoneOfDay(field, timeZone)));
}

/** One stored filter row as the reader takes it. */
function readerFilter(
  row: ListFilter,
  collection: string,
  ctx: Pick<PageContext, "timeZone" | "fieldShapes">
): BlocksFilter {
  const zone =
    comparesOrder(row.op) && isListDay(row.value)
      ? dayZoneOf(row.field, collection, ctx)
      : undefined;
  return zone === undefined || !isListDay(row.value)
    ? { field: row.field, op: READER_OP[row.op], value: row.value }
    : dayRow({ ...row, value: row.value }, zone);
}

/** The stored filter rows as the reader takes them. */
function readerFilters(
  filters: readonly ListFilter[],
  collection: string,
  ctx: Pick<PageContext, "timeZone" | "fieldShapes">
): BlocksFilter[] {
  return filters.map(row => readerFilter(row, collection, ctx));
}

/** The id one related value names: an id, or an entry read in its place. */
function idOf(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = value.id;
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
        "This page isn't an entry in a collection, so it has no related entries to show.",
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
function sortFallback(fields: readonly string[]): ListDiagnostic {
  const named = fields.map(field => `"${field}"`).join(", ");
  return {
    kind: "sort-fallback",
    // The collection goes unnamed: the renderer holds only its slug, and the
    // author is looking at the list, whose collection the Source shows.
    message: `This list sorts by ${named}, which its collection no longer has or visitors can't see. It shows entries in ID order.`,
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

/** A list's rows, as one read or several give them back. */
type Rows = readonly Record<string, unknown>[];

/** A read with the stored keys, or with none, which the reader orders by id. */
function sortedQuery(query: BlocksQuery, sort: readonly string[]): BlocksQuery {
  return { ...query, sort: sort.length === 0 ? [] : sort.join(",") };
}

/**
 * A sorted read, and the same read in id order when the reader refused the
 * stored sort. `run` makes the read with the keys it is given. The first
 * read is claimed by the caller; a retry after a refusal made before
 * reading costs no second claim, and one made after reading (a hidden field,
 * which the reader judges once it has read) claims its own.
 */
async function readSorted(
  reads: ListReads,
  run: (sort: readonly string[]) => Promise<Rows>,
  sort: readonly string[]
): Promise<{ items: Rows; diagnostic?: ListDiagnostic }> {
  if (sort.length === 0) return { items: await run([]) };
  try {
    return { items: await run(sort) };
  } catch (error) {
    if (!readWasRefused(error)) throw error;
    const named = refusedSortFields(error);
    if (named.length === 0 && !reads.claim()) throw error;
    return {
      items: await run([]),
      diagnostic: sortFallback(
        named.length > 0 ? named : sort.map(key => key.replace(/^-/, ""))
      ),
    };
  }
}

/** A list's read of its collection, sorted as stored or in id order. */
async function readCollection(
  reads: ListReads,
  base: BlocksQuery,
  sort: readonly string[]
): Promise<{ items: Rows; diagnostic?: ListDiagnostic }> {
  return readSorted(reads, keys => reads.find(sortedQuery(base, keys)), sort);
}

/** Claim one more read, or stop the list's read: its entries are not all read. */
function claimOrStop(reads: ListReads): void {
  if (!reads.claim()) {
    throw new Error(
      "This page has used up the reads it may make, so this list's related entries were not all read."
    );
  }
}

/** A row's id as a key, so a string id and a number id compare alike. */
function idKey(row: Readonly<Record<string, unknown>>): string {
  return String(row.id);
}

/** How many entries of each side one merging read orders: half a read each. */
const MERGE_SIDE = RELATED_READ_SIZE / 2;

/**
 * Two runs of rows, each in the reader's order, merged into the first
 * `wanted` of both in that order.
 *
 * The reader decides every comparison, as the database's own collation and
 * its empty-values-last order cannot be repeated here: up to half a read
 * from the front of each run is read again together, by id and with the
 * sort, and the rows are taken in the order that read gives until one side's
 * part is used up while that side has more, since a row after that point
 * could belong behind a row not yet read. Each read takes at least one whole
 * part, so the merge ends; each is claimed from the page's allowance.
 *
 * A row that no longer matches when read again (it changed between reads)
 * is dropped from its run and the step is taken again.
 */
async function mergeInOrder(
  reads: ListReads,
  order: (ids: readonly (string | number)[]) => Promise<Rows>,
  runs: { readonly left: Rows; readonly right: Rows },
  wanted: number
): Promise<Rows> {
  const merged: Record<string, unknown>[] = [];
  let left = runs.left;
  let right = runs.right;
  while (merged.length < wanted && left.length > 0 && right.length > 0) {
    const fromLeft = left.slice(0, MERGE_SIDE);
    const fromRight = right.slice(0, MERGE_SIDE);
    claimOrStop(reads);
    const together = await order(
      [...fromLeft, ...fromRight].flatMap(row => {
        const id = idOf(row.id);
        return id === undefined ? [] : [id];
      })
    );
    const present = new Set(together.map(idKey));
    if (present.size < fromLeft.length + fromRight.length) {
      left = left.filter(
        row => present.has(idKey(row)) || !fromLeft.includes(row)
      );
      right = right.filter(
        row => present.has(idKey(row)) || !fromRight.includes(row)
      );
      continue;
    }
    const taken = takeInOrder(together, {
      left: new Set(fromLeft.map(idKey)),
      leftMore: left.length > fromLeft.length,
      rightSize: fromRight.length,
      rightMore: right.length > fromRight.length,
      room: wanted - merged.length,
    });
    merged.push(...taken.rows);
    left = left.slice(taken.left);
    right = right.slice(taken.right);
  }
  return [...merged, ...left, ...right].slice(0, wanted);
}

/**
 * The rows of one merging read that are surely next, in its order: up to
 * and including the last of a side's part when that side has more, and no
 * more than `room`. With how many it took from each side.
 */
function takeInOrder(
  together: Rows,
  sides: {
    readonly left: ReadonlySet<string>;
    readonly leftMore: boolean;
    readonly rightSize: number;
    readonly rightMore: boolean;
    readonly room: number;
  }
): { rows: Rows; left: number; right: number } {
  const rows: Record<string, unknown>[] = [];
  let left = 0;
  let right = 0;
  for (const row of together) {
    if (rows.length >= sides.room) break;
    rows.push(row);
    if (sides.left.has(idKey(row))) left += 1;
    else right += 1;
    const leftDone = left === sides.left.size && sides.leftMore;
    const rightDone = right === sides.rightSize && sides.rightMore;
    if (leftDone || rightDone) break;
  }
  return { rows, left, right };
}

/**
 * The entries of a related source with a sort, when it holds more ids than
 * one read takes. The ids are read a read's worth at a time, each sorted
 * and cut to the window's end, and each read's rows are merged into the
 * ones kept so far by the reader's own order ({@link mergeInOrder}), so the
 * window is cut from the whole relation in the order one read of it would
 * give. Every read names at most a read's worth of ids and asks for at
 * most a read's worth of rows; each after the first is claimed.
 */
async function readRelatedSorted(
  reads: ListReads,
  base: BlocksQuery,
  sort: readonly string[],
  ids: readonly (string | number)[],
  window: { readonly offset: number; readonly limit: number }
): Promise<Rows> {
  const wanted = window.offset + window.limit;
  const { offset: _offset, ...unwindowed } = base;
  const named = (chunk: readonly (string | number)[], limit: number) =>
    reads.find(
      sortedQuery(
        {
          ...unwindowed,
          filters: [
            ...(base.filters ?? []),
            { field: "id", op: "in", value: chunk },
          ],
          limit,
        },
        sort
      )
    );
  let kept: Rows = [];
  for (let start = 0; start < ids.length; start += RELATED_READ_SIZE) {
    if (start > 0) claimOrStop(reads);
    const read = await named(
      ids.slice(start, start + RELATED_READ_SIZE),
      Math.min(wanted, RELATED_READ_SIZE)
    );
    kept = await mergeInOrder(
      reads,
      chunk => named(chunk, chunk.length),
      { left: kept, right: read },
      wanted
    );
  }
  return kept.slice(window.offset, wanted);
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
  // as a stored list always did, and a malformed split into pages shows one
  // page; anything else would read the wrong entries.
  const blocking = problems.filter(
    problem =>
      problem.prop !== "limit" &&
      problem.prop !== "sort" &&
      problem.prop !== "paginate"
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
 * reads it, the reader's base query with its window, and the sort keys it
 * reads with. One reading, so the list's read and the editor's count of it
 * cannot drift apart.
 */
function listReadBase(
  props: unknown,
  collection: string,
  ctx: Pick<PageContext, "locale" | "timeZone" | "fieldShapes">
):
  | { readonly blocking: string }
  | {
      readonly query: ListQuery;
      readonly base: BlocksQuery;
      readonly offset: number;
      readonly limit: number;
      readonly sort: readonly string[];
      /** Why the stored sort is not read, which lists in id order. */
      readonly sortProblem?: string;
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
  const sortProblem = problems.find(problem => problem.prop === "sort");
  return {
    query,
    base,
    offset,
    limit,
    sort: sortProblem === undefined ? sortTexts(query) : [],
    ...(sortProblem === undefined ? {} : { sortProblem: sortProblem.message }),
  };
}

/**
 * How many entries a list's query matches, and how many of them it shows:
 * those after the skipped ones, up to its limit.
 *
 * @experimental
 */
export interface ListEntryCount {
  readonly matching: number;
  readonly shown: number;
}

/**
 * The editor's count of a list's matching entries, taken from the list's own
 * read: the very reads the list makes of `data` (its sort, and its id order
 * when the sort is refused), whose answer's total is the count. A provider
 * that keeps its answers therefore counts the rows it drew, never a second
 * read of its own. Undefined where the list's read does not say: no
 * collection named, a query that cannot be read as stored, a related source
 * (its ids are read from the entry or the outer item first), and a provider
 * that gives no total.
 *
 * @experimental
 */
export async function listEntryCount(
  props: unknown,
  terms: Pick<PageContext, "locale" | "timeZone" | "fieldShapes">,
  data: BlocksDataProvider,
  /**
   * Claim each read after the first, as the list's own reads are claimed
   * from a page's allowance. Absent, the editor's count reads freely.
   */
  claim: () => boolean = () => true
): Promise<ListEntryCount | undefined> {
  const named = readListQuery(props).query;
  if (named.collection === undefined || named.relation !== undefined) {
    return undefined;
  }
  const read = listReadBase(props, named.collection, terms);
  if ("blocking" in read) return undefined;
  let total: number | undefined;
  await readCollection(
    {
      find: async query => {
        const answer = await data.find(query);
        total = answer.total;
        return answer.items;
      },
      claim,
    },
    read.base,
    read.sort
  );
  // Held to a whole number from 0, as a list's own links hold it.
  const counted = wholeCount(total);
  if (counted === undefined) return undefined;
  return {
    matching: counted,
    shown: Math.max(0, Math.min(counted - read.offset, read.limit)),
  };
}

/**
 * Whether a list's stored props make a read at all: a collection named, no
 * related source (whose entries are never paged), and nothing stored that
 * stops the read. The one answer the route's count and the render ask
 * before claiming a paginated list's read, so neither spends one the list
 * will not make.
 *
 * @experimental Settles with list pagination.
 */
export function listWillRead(props: unknown): boolean {
  const { query, problems } = readListQuery(props);
  return (
    query.collection !== undefined &&
    query.relation === undefined &&
    blockingProblem(problems) === undefined
  );
}

/**
 * A provider's total as a count may be: a whole number from 0, or undefined
 * for anything else (`NaN`, `Infinity`, a fraction, a negative). The one
 * reading the route's page count and a list's page links share, so a total
 * neither trusts can never give one of them pages the other lacks.
 *
 * @experimental Settles with list pagination.
 */
export function wholeCount(total: unknown): number | undefined {
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0
    ? total
    : undefined;
}

/**
 * How many pages a list split into pages has when its query matches
 * `matching` entries, by its stored offset and limit as its read takes them.
 *
 * @experimental Settles with list pagination.
 */
export function listPagesOf(props: unknown, matching: number): number {
  const offset = readListQuery(props).query.offset ?? 0;
  const limit = safeLimit((props as { limit?: unknown } | null)?.limit);
  return listPageCount(matching, offset, limit);
}

/**
 * Read a list's entries as its stored props ask: page `page` of them, from
 * 1, where the list is split into pages. Never throws: a read that fails
 * comes back as `failed` with what failed, and the list draws its empty
 * state.
 */
export async function readList(
  props: unknown,
  collection: string,
  ctx: PageContext,
  reads: ListReads,
  page = 1
): Promise<ListOutcome> {
  const read = listReadBase(props, collection, ctx);
  if ("blocking" in read) {
    return { items: [], failed: true, diagnostic: failure(read.blocking) };
  }
  const { query, base: first, limit, sort, sortProblem } = read;
  // A later page starts `limit` entries further on for each page before it,
  // the stored offset applied once, before paging. The window moves in the
  // read itself rather than through the reader's page number, so a provider
  // that knows nothing of pages still reads the right entries. Related
  // entries are never paged: they have no count of pages.
  const paged = page > 1 && query.relation === undefined;
  const offset = paged ? read.offset + (page - 1) * limit : read.offset;
  const base = paged ? { ...first, offset } : first;
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
    const found = await readSource(base, sort, related?.ids, reads, {
      offset,
      limit,
    });
    const diagnostic =
      found.diagnostic ??
      (sortProblem === undefined
        ? undefined
        : { kind: "sort-fallback" as const, message: sortProblem });
    return {
      items: found.items,
      failed: false,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    };
  } catch (error) {
    return { items: [], failed: true, diagnostic: failure(errorDetail(error)) };
  }
}

/**
 * Read from the list's source: its collection, or, when `ids` is given, the
 * related entries those ids name: in their stored order with no sort, in
 * one read with a sort when they fit one, and read by parts and merged in
 * the reader's order when they do not.
 */
async function readSource(
  base: BlocksQuery,
  sort: readonly string[],
  ids: readonly (string | number)[] | undefined,
  reads: ListReads,
  window: { readonly offset: number; readonly limit: number }
): Promise<{ items: Rows; diagnostic?: ListDiagnostic }> {
  if (ids === undefined) return readCollection(reads, base, sort);
  if (ids.length === 0) return { items: [] };
  if (sort.length === 0) {
    const { offset: _offset, ...unwindowed } = base;
    return { items: await readInStoredOrder(reads, unwindowed, ids, window) };
  }
  if (ids.length <= RELATED_READ_SIZE) {
    return readCollection(
      reads,
      {
        ...base,
        filters: [
          ...(base.filters ?? []),
          { field: "id", op: "in", value: ids },
        ],
      },
      sort
    );
  }
  return readSorted(
    reads,
    keys => readRelatedSorted(reads, base, keys, ids, window),
    sort
  );
}
