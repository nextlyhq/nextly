/**
 * Reading a list's stored props into a query: the field-name, operator and
 * day checks, each filter row, the sort keys, the related source, a custom
 * source and its inputs, and the window, with the problem each one has.
 *
 * @module list-query-read
 */
import { isCalendarDay } from "./calendar-day";
import { isTopLevelFieldName } from "./field-name";
import { describeValue } from "./issue-text";
import {
  LIST_FILTER_OPS,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  LIST_MAX_VALUES,
  type ListFilter,
  type ListFilterOp,
  type ListFilterScalar,
  type ListNamedQuery,
  type ListQuery,
  type ListQueryProblem,
  type ListRelation,
  type ListShapeCode,
  type ListSortKey,
} from "./list-query-contract";
import {
  isNamedQueryName,
  isNamedQueryParamKey,
  NAMED_QUERY_MAX_PARAMS,
  NAMED_QUERY_TEXT_MAX,
  type NamedQueryParamValue,
} from "./named-query";
import { isPlainRecord } from "./plain-record";

/**
 * Whether a value is a field name a list or a condition may write: one
 * top-level field, no paths, operators or quoting.
 */
export function isListFieldName(value: unknown): value is string {
  return isTopLevelFieldName(value);
}

/** Whether `op` is one of the closed set. */
export function isListFilterOp(op: unknown): op is ListFilterOp {
  return (
    typeof op === "string" &&
    (LIST_FILTER_OPS as readonly string[]).includes(op)
  );
}

/**
 * Whether a value is a calendar day, `YYYY-MM-DD`, that exists: a date filter
 * stores the day an author picked, and the reader compares whole days.
 */
export function isListDay(value: unknown): value is string {
  return isCalendarDay(value);
}

/**
 * The day after a `YYYY-MM-DD` day, for comparing whole days: "after the 1st"
 * is "from the start of the 2nd". A list's day filter and a condition on a
 * day read it alike.
 */
export function listDayAfter(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + 1))
    .toISOString()
    .slice(0, 10);
}

function isScalar(value: unknown): value is ListFilterScalar {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Why a value is not a list of values an `in` row takes. */
function listValueProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return "takes a list of one value or more";
  }
  if (value.length > LIST_MAX_VALUES) {
    return `takes at most ${String(LIST_MAX_VALUES)} values`;
  }
  return value.every(isScalar)
    ? undefined
    : "takes text, numbers or yes-or-no values";
}

/** Why a value is not one an order compares: a number, or a day. */
function orderValueProblem(value: unknown): string | undefined {
  return (typeof value === "number" && Number.isFinite(value)) ||
    isListDay(value)
    ? undefined
    : "takes a number, or a day written YYYY-MM-DD";
}

/** Why a value is not one literal. */
function scalarValueProblem(value: unknown): string | undefined {
  return isScalar(value) ? undefined : "takes one text, number or yes-or-no";
}

/**
 * What each operator takes, as the reason a value does not fit it. A table,
 * so an operator added to the set fails to compile here until it is given
 * one.
 */
const VALUE_RULES: Readonly<
  Record<ListFilterOp, (value: unknown) => string | undefined>
> = {
  equals: scalarValueProblem,
  not_equals: scalarValueProblem,
  greater_than: orderValueProblem,
  greater_than_equal: orderValueProblem,
  less_than: orderValueProblem,
  less_than_equal: orderValueProblem,
  contains: value =>
    typeof value === "string" && value !== ""
      ? undefined
      : "takes the text to look for",
  in: listValueProblem,
  not_in: listValueProblem,
  exists: value =>
    typeof value === "boolean"
      ? undefined
      : "takes true (has a value) or false (is empty)",
};

/** Why a filter row's value does not fit its operator, or nothing when it does. */
function valueProblem(op: ListFilterOp, value: unknown): string | undefined {
  return VALUE_RULES[op](value);
}

/** One stored filter row read, or why it could not be. */
function readFilter(
  row: unknown,
  index: number
): ListFilter | ListQueryProblem {
  const where = `Filter ${String(index + 1)}`;
  const problem = (message: string): ListQueryProblem => ({
    prop: "filters",
    code: "list-filter-invalid",
    message: `${where} ${message}.`,
  });
  if (!isPlainRecord(row)) return problem("is not a filter row");
  const extra = Object.keys(row).filter(
    key => key !== "field" && key !== "op" && key !== "value"
  );
  if (extra.length > 0) {
    return problem(
      `holds ${extra.map(key => `"${describeValue(key)}"`).join(", ")}, which a filter row does not take`
    );
  }
  if (!isListFieldName(row.field)) {
    return problem(`names "${describeValue(row.field)}", which is not a field`);
  }
  if (!isListFilterOp(row.op)) {
    return problem(
      `uses "${describeValue(row.op)}", which is not one of: ${LIST_FILTER_OPS.join(", ")}`
    );
  }
  const wrong = valueProblem(row.op, row.value);
  if (wrong !== undefined) {
    return problem(`on "${row.field}" ${wrong}`);
  }
  return {
    field: row.field,
    op: row.op,
    value: Array.isArray(row.value)
      ? (row.value as ListFilterScalar[]).slice()
      : (row.value as ListFilterScalar),
  };
}

/**
 * The stored sort read as keys: split on commas, each trimmed, empty ones
 * skipped, as the reader that orders the rows splits and skips them, and
 * held to {@link LIST_MAX_SORT_LENGTH} and {@link LIST_MAX_SORT_KEYS}.
 */
function readSort(
  value: unknown
): { keys: ListSortKey[] } | { problem: ListQueryProblem } {
  if (value === undefined || value === null) return { keys: [] };
  const read =
    typeof value === "string"
      ? sortKeysIn(value)
      : "The sort is not text naming fields, such as -date,title.";
  return typeof read === "string"
    ? { problem: { prop: "sort", code: "list-sort-invalid", message: read } }
    : { keys: read };
}

/** A stored sort string's keys, or why it is not a sort a list stores. */
function sortKeysIn(stored: string): ListSortKey[] | string {
  // Bounded before it is split, so no reader splits a sort without bound.
  if (stored.length > LIST_MAX_SORT_LENGTH) {
    return `A list's sort holds at most ${String(LIST_MAX_SORT_LENGTH)} characters; this one holds ${String(stored.length)}.`;
  }
  const keys: ListSortKey[] = [];
  for (const part of stored.split(",")) {
    const text = part.trim();
    if (text === "") continue;
    const descending = text.startsWith("-");
    const field = (descending ? text.slice(1) : text).trim();
    if (!isListFieldName(field)) {
      return `The sort names "${describeValue(text)}", which is not a field name, such as -date.`;
    }
    keys.push({ field, descending });
  }
  if (keys.length > LIST_MAX_SORT_KEYS) {
    return `A list sorts by at most ${String(LIST_MAX_SORT_KEYS)} fields; this one sorts by ${String(keys.length)}.`;
  }
  return keys;
}

/**
 * Sort keys as the block stores them: one string, comma-separated, `-` for
 * descending, or `undefined` for no keys, which removes the sort. The one
 * spelling {@link readListQuery} reads back, so an editor writing keys and
 * the reader ordering by them cannot disagree about it.
 */
export function listSortText(keys: readonly ListSortKey[]): string | undefined {
  if (keys.length === 0) return undefined;
  return keys
    .map(key => (key.descending ? `-${key.field}` : key.field))
    .join(",");
}

/** A whole number within bounds, or why it is not. */
function wholeNumber(
  value: unknown,
  min: number,
  max: number
): number | undefined {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
    ? value
    : undefined;
}

function readRelation(
  value: unknown,
  collection: string | undefined
): ListRelation | ListQueryProblem | undefined {
  if (value === undefined || value === null) return undefined;
  const problem = (message: string): ListQueryProblem => ({
    prop: "relation",
    code: "list-relation-invalid",
    message,
  });
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some(key => key !== "of" && key !== "field")
  ) {
    return problem(
      'The related source is not { of: "entry" | "item", field }.'
    );
  }
  if (value.of !== "entry" && value.of !== "item") {
    return problem(
      `The related source is of "${describeValue(value.of)}", which is neither "entry" nor "item".`
    );
  }
  if (!isListFieldName(value.field)) {
    return problem(
      `The related source names "${describeValue(value.field)}", which is not a field.`
    );
  }
  if (collection === undefined) {
    return problem(
      "A related source needs the collection its entries are in, named as the list's collection."
    );
  }
  return { of: value.of, field: value.field };
}

/** A problem with a list's custom source. */
function namedProblem(message: string): ListQueryProblem {
  return { prop: "namedQuery", code: "list-named-query-invalid", message };
}

/** Why one stored input is not a literal a list may hold, or nothing. */
function storedParamProblem(key: string, value: unknown): string | undefined {
  if (!isNamedQueryParamKey(key)) {
    return `The custom source holds an input named "${describeValue(key)}", which is not an input's key.`;
  }
  if (
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))
  ) {
    return `Input "${key}" holds ${describeValue(value)}, which is not a text, number or yes-or-no value.`;
  }
  if (typeof value === "string" && value.length > NAMED_QUERY_TEXT_MAX) {
    return `Input "${key}" holds more than ${String(NAMED_QUERY_TEXT_MAX)} characters.`;
  }
  return undefined;
}

/** A stored custom source's inputs, or why they are not a record of literals. */
function readNamedParams(
  value: unknown
): Record<string, NamedQueryParamValue> | ListQueryProblem {
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value)) {
    return namedProblem(
      "The custom source's inputs are not a record of values."
    );
  }
  const keys = Object.keys(value);
  if (keys.length > NAMED_QUERY_MAX_PARAMS) {
    return namedProblem(
      `A custom source holds at most ${String(NAMED_QUERY_MAX_PARAMS)} inputs; this one holds ${String(keys.length)}.`
    );
  }
  const params: Record<string, NamedQueryParamValue> = {};
  for (const key of keys) {
    const problem = storedParamProblem(key, value[key]);
    if (problem !== undefined) return namedProblem(problem);
    params[key] = value[key] as NamedQueryParamValue;
  }
  return params;
}

/** A stored custom source read, or why it could not be. */
function readNamedQuery(
  value: unknown
): ListNamedQuery | ListQueryProblem | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    !isPlainRecord(value) ||
    Object.keys(value).some(key => key !== "name" && key !== "params")
  ) {
    return namedProblem("The custom source is not { name, params }.");
  }
  if (!isNamedQueryName(value.name)) {
    return namedProblem(
      `The custom source names "${describeValue(value.name)}", which is not a query name.`
    );
  }
  const params = readNamedParams(value.params);
  return isProblem(params) ? params : { name: value.name, params };
}

/**
 * Why a stored custom source sits beside another source, or nothing. Empty
 * filters and an empty sort name nothing, so they do not count.
 */
/**
 * Whether a list's props name a source besides a custom one: a collection,
 * related entries, filters or a sort. Empty filters, an empty sort and a
 * blank collection name nothing, as `readListQuery` reads them. The one
 * answer the save and a write that sets a custom source both ask.
 */
export function namesListSource(
  record: Readonly<Record<string, unknown>>
): boolean {
  const stored = (value: unknown) => value !== undefined && value !== null;
  const filters = record.filters;
  const sort = record.sort;
  return (
    collectionOf(record.collection) !== undefined ||
    stored(record.relation) ||
    (Array.isArray(filters) ? filters.length > 0 : stored(filters)) ||
    (typeof sort === "string" ? sort.trim() !== "" : stored(sort))
  );
}

function sourceConflict(
  record: Readonly<Record<string, unknown>>
): ListQueryProblem | undefined {
  if (record.namedQuery === undefined || record.namedQuery === null) {
    return undefined;
  }
  return namesListSource(record)
    ? {
        prop: "namedQuery",
        code: "list-source-conflict",
        message:
          "This list's source is a custom source, so it can't also name a collection, related entries, filters or sort.",
      }
    : undefined;
}

function isProblem(value: unknown): value is ListQueryProblem {
  return isPlainRecord(value) && typeof value.code === "string";
}

/** A stored whole number within bounds, or the problem it is. */
function readBound(
  value: unknown,
  bound: {
    readonly prop: "limit" | "offset";
    readonly min: number;
    readonly max: number;
    readonly code: ListShapeCode;
    readonly message: (stored: string) => string;
  }
): { value?: number; problem?: ListQueryProblem } {
  if (value === undefined) return {};
  const read = wholeNumber(value, bound.min, bound.max);
  if (read !== undefined) return { value: read };
  return {
    problem: {
      prop: bound.prop,
      code: bound.code,
      message: bound.message(describeValue(value)),
    },
  };
}

/** The stored filter rows read, each one that could not be named. */
function readFilters(value: unknown): {
  filters: ListFilter[];
  problems: ListQueryProblem[];
} {
  if (value === undefined) return { filters: [], problems: [] };
  const refused = (message: string) => ({
    filters: [],
    problems: [
      {
        prop: "filters" as const,
        code: "list-filter-invalid" as const,
        message,
      },
    ],
  });
  if (!Array.isArray(value)) {
    return refused("The filters are not a list of filter rows.");
  }
  if (value.length > LIST_MAX_FILTERS) {
    return refused(
      `A list holds at most ${String(LIST_MAX_FILTERS)} filters; this one holds ${String(value.length)}.`
    );
  }
  const filters: ListFilter[] = [];
  const problems: ListQueryProblem[] = [];
  // Index-based, so a hole in a sparse list is read as the row it is.
  for (let index = 0; index < value.length; index += 1) {
    const read = readFilter(value[index] as unknown, index);
    if (isProblem(read)) problems.push(read);
    else filters.push(read);
  }
  return { filters, problems };
}

/**
 * The collection a list names, trimmed. A cleared text field persists as an
 * empty string, which names no collection rather than one called "".
 */
function collectionOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * A list's stored props read as its query, with every part that could not
 * be read named. A part that could not be read is left out of the query, so
 * a caller can tell "not stored" from "stored badly" by the problems.
 */
export function readListQuery(props: unknown): {
  readonly query: ListQuery;
  readonly problems: readonly ListQueryProblem[];
} {
  const record = isPlainRecord(props) ? props : {};
  const collection = collectionOf(record.collection);
  const limit = readBound(record.limit, {
    prop: "limit",
    min: LIST_LIMIT_MIN,
    max: LIST_LIMIT_MAX,
    code: "list-limit-invalid",
    message: stored =>
      `Number of items is ${stored}. Show between ${String(LIST_LIMIT_MIN)} and ${String(LIST_LIMIT_MAX)} entries.`,
  });
  const offset = readBound(record.offset, {
    prop: "offset",
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    code: "list-offset-invalid",
    message: stored =>
      `The number of entries to skip is ${stored}. Skip a whole number of entries, 0 or more.`,
  });
  const paginate = readPaginate(record.paginate);
  const filters = readFilters(record.filters);
  const sorted = readSort(record.sort);
  const relation = readRelation(record.relation, collection);
  const named = readNamedQuery(record.namedQuery);
  const problems = [
    limit.problem,
    offset.problem,
    paginate.problem,
    ...filters.problems,
    "problem" in sorted ? sorted.problem : undefined,
    isProblem(relation) ? relation : undefined,
    isProblem(named) ? named : undefined,
    sourceConflict(record),
  ].filter((problem): problem is ListQueryProblem => problem !== undefined);
  return {
    query: {
      ...(collection === undefined ? {} : { collection }),
      ...(relation === undefined || isProblem(relation) ? {} : { relation }),
      ...(named === undefined || isProblem(named) ? {} : { namedQuery: named }),
      filters: filters.filters,
      sort: "keys" in sorted ? sorted.keys : [],
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(offset.value === undefined ? {} : { offset: offset.value }),
      ...(paginate.value === true ? { paginate: true as const } : {}),
    },
    problems,
  };
}

/**
 * The stored split into pages: on when `true`, off when absent or `false`,
 * which a switch turned off stores.
 */
function readPaginate(value: unknown): {
  value?: true;
  problem?: ListQueryProblem;
} {
  if (value === undefined || value === false) return {};
  if (value === true) return { value: true };
  return {
    problem: {
      prop: "paginate",
      code: "list-paginate-invalid",
      message: `Split into pages is ${describeValue(value)}. Turn it on or off.`,
    },
  };
}
