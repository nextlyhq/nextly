/**
 * A collection list's query, as `core/collection-loop` stores it: where its
 * entries come from, the filter rows that narrow them, the keys that order
 * them and the window that cuts them.
 *
 * The block's props are outside input: an editor writes them, and so do an
 * import, a script and an agent through the API. This module is the ONE
 * reading of them. The validator judges a save with it, and the renderer
 * builds its read from it, so a list that saves is a list that reads the
 * same way, and a stored list that no longer fits is told apart by the same
 * rules on both sides.
 *
 * What is stored, all of it optional and added beside the block's original
 * `collection`, `limit` and `sort`, so a list stored before any of it reads
 * as it always did:
 *
 * - `filters`: rows of `{ field, op, value }`, all of which must hold. The
 *   operators are a closed set, spelled as the Direct API spells them, and
 *   the value is a typed literal: never a raw query.
 * - `sort`: the keys as one string, comma-separated, `-` for descending
 *   (`-publishedAt,title`), as the block has always stored it. The reader
 *   adds the id as the last key, so it is never stored.
 * - `offset`: how many matching entries to skip, a whole number from 0.
 * - `limit`: how many to show, 1 to 100.
 * - `relation`: the entries of a to-many relation of the page's entry
 *   (`of: "entry"`) or of the item the list sits in (`of: "item"`), named
 *   by its field. `collection` then names the related collection, so what
 *   the list's children bind to is checked as for any list.
 *
 * Which fields a list may name is a question about the schema and about who
 * may read it, so it is asked of a {@link ListFieldSource} the caller
 * supplies: the engine reads no storage. A list's filter or sort may use only
 * fields the public may read, since which entries show, and in what order,
 * would otherwise reveal a field no visitor may see.
 *
 * @module list-query
 */
import type { BindingFieldShape } from "./binding-rules";
import { bindingKindOf } from "./binding-vocabulary";
import type { BlockDocument, BlockNode } from "./document";
import { withHeldSeverity } from "./held-findings";
import { describeValue, pointer } from "./issue-text";
import { isPlainRecord } from "./plain-record";
import { locateNode } from "./tree";

/** The block a list query belongs to. */
export const COLLECTION_LIST_TYPE = "core/collection-loop";

/**
 * The slot a list draws once per entry, with that entry as the item. Its
 * other slot, the empty state, is drawn with no entry of its own, so a list
 * inside it has the item around the outer list, as the renderer draws it.
 */
export const LIST_ENTRY_SLOT = "children";

/**
 * The list whose entry is the item where `id` sits, nearest first: the list
 * whose per-entry slot holds it, at any depth, passing over a list it sits
 * in the empty state of. `undefined` outside every list's entries. The one
 * answer, as {@link listQueryIssues} judges a related list's outer item, for
 * an editor offering related sources where the block sits.
 */
export function outerListOf(
  nodes: BlockNode[],
  id: string
): BlockNode | undefined {
  let at = locateNode(nodes, id);
  // Bounded by the document's depth: each step moves one parent out.
  while (at?.parent !== undefined) {
    const parent = at.parent;
    if (parent.type === COLLECTION_LIST_TYPE && at.slot === LIST_ENTRY_SLOT) {
      return parent;
    }
    at = locateNode(nodes, parent.id);
  }
  return undefined;
}

/**
 * The operators a filter row may use, as the Direct API spells them. Closed:
 * each means the same on every database, and `contains` ignores case.
 */
export const LIST_FILTER_OPS = [
  "equals",
  "not_equals",
  "greater_than",
  "greater_than_equal",
  "less_than",
  "less_than_equal",
  "contains",
  "in",
  "not_in",
  "exists",
] as const;

/** One of {@link LIST_FILTER_OPS}. */
export type ListFilterOp = (typeof LIST_FILTER_OPS)[number];

/** A literal a filter compares with. */
export type ListFilterScalar = string | number | boolean;

/** One filter row: a field, an operator and a typed value. */
export interface ListFilter {
  readonly field: string;
  readonly op: ListFilterOp;
  readonly value: ListFilterScalar | readonly ListFilterScalar[];
}

/** One sort key: the field it orders by, and which way. */
export interface ListSortKey {
  readonly field: string;
  readonly descending: boolean;
}

/** Where a list's entries come from when they are a relation's. */
export interface ListRelation {
  /** The page's entry, or the item of the list this one sits in. */
  readonly of: "entry" | "item";
  /** The to-many relation field holding the entries. */
  readonly field: string;
}

/** The bounds of `limit`, the number of entries a list shows. */
export const LIST_LIMIT_MIN = 1;
export const LIST_LIMIT_MAX = 100;

/** How many filter rows one list may hold, and values one `in` row. */
export const LIST_MAX_FILTERS = 20;
export const LIST_MAX_VALUES = 100;

/**
 * How many keys one list sorts by, and how many characters its stored sort
 * holds: room for every key naming a field as long as a database column may
 * be (63 characters), with the separators, and more. Every reader of a sort
 * holds it to these, the save and a request for a list's entries alike, so
 * none takes a sort another refuses, and none is handed one without bound.
 */
export const LIST_MAX_SORT_KEYS = 20;
export const LIST_MAX_SORT_LENGTH = 2000;

/** A list's query as stored, each part present only when it was stored well. */
export interface ListQuery {
  /** The collection read, trimmed; absent when none is named. */
  readonly collection?: string;
  readonly relation?: ListRelation;
  readonly filters: readonly ListFilter[];
  readonly sort: readonly ListSortKey[];
  readonly limit?: number;
  readonly offset?: number;
}

/** The props a stored list query is read from. */
export type ListQueryProp =
  | "collection"
  | "relation"
  | "filters"
  | "sort"
  | "limit"
  | "offset";

/** Why part of a stored list query could not be read. */
export interface ListQueryProblem {
  readonly prop: ListQueryProp;
  readonly code: ListShapeCode;
  readonly message: string;
}

/** The codes a list's own shape is refused with. */
export type ListShapeCode =
  | "list-limit-invalid"
  | "list-offset-invalid"
  | "list-filter-invalid"
  | "list-sort-invalid"
  | "list-relation-invalid";

/** The codes a list is refused with when judged against the schema. */
export type ListFieldCode =
  | "list-field-unknown"
  | "list-field-protected"
  | "list-field-unsortable"
  | "list-field-unfilterable"
  | "list-filter-unsuited"
  | "list-relation-unsuitable"
  | "list-relation-no-entry"
  | "list-too-deep";

/** Every code a list query is judged with, each described for authors. */
export const LIST_ISSUE_CODES: {
  readonly [Code in ListShapeCode | ListFieldCode]: string;
} = {
  "list-limit-invalid":
    "A list's number of items is not a whole number from 1 to 100.",
  "list-offset-invalid":
    "A list's number of entries to skip is not a whole number from 0.",
  "list-filter-invalid":
    "A list's filter row is not a field, an operator and a value that operator takes.",
  "list-sort-invalid": "A list's sort is not a list of field names.",
  "list-relation-invalid":
    "A list's related source does not name the entry or the outer item and a field.",
  "list-field-unknown":
    "A list filters or sorts by a field its collection does not have.",
  "list-field-protected":
    "A list filters or sorts by a field visitors may not see.",
  "list-field-unsortable":
    "A list sorts by a field it cannot order by: one holding more than one value, a relation, or no one value to compare.",
  "list-field-unfilterable":
    "A list filters by a field it cannot compare: one holding more than one value, or no one value to compare.",
  "list-filter-unsuited":
    "A list's filter compares a field with an operator or a value its kind does not take.",
  "list-relation-unsuitable":
    "A list's related source is not a to-many relation to its collection.",
  "list-relation-no-entry":
    "A list shows related entries of the page's entry on a page that is not an entry of a collection.",
  "list-too-deep":
    "A list shows related entries of a list that already shows related entries.",
};

/** A field name as a list may write it: no paths, operators or quoting. */
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A calendar day, as a date filter stores it. */
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether a value is a field name a list or a condition may write: one
 * top-level field, no paths, operators or quoting.
 */
export function isListFieldName(value: unknown): value is string {
  return (
    typeof value === "string" && FIELD_NAME.test(value) && value !== "__proto__"
  );
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
  if (typeof value !== "string") return false;
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
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
  const filters = readFilters(record.filters);
  const sorted = readSort(record.sort);
  const relation = readRelation(record.relation, collection);
  const problems = [
    limit.problem,
    offset.problem,
    ...filters.problems,
    "problem" in sorted ? sorted.problem : undefined,
    isProblem(relation) ? relation : undefined,
  ].filter((problem): problem is ListQueryProblem => problem !== undefined);
  return {
    query: {
      ...(collection === undefined ? {} : { collection }),
      ...(relation === undefined || isProblem(relation) ? {} : { relation }),
      filters: filters.filters,
      sort: "keys" in sorted ? sorted.keys : [],
      ...(limit.value === undefined ? {} : { limit: limit.value }),
      ...(offset.value === undefined ? {} : { offset: offset.value }),
    },
    problems,
  };
}

/** The fields of one collection, as a list's filters and sort are judged. */
export interface ListFields {
  /** Every field the collection declares, its id and timestamps included. */
  readonly declared: ReadonlySet<string>;
  /**
   * The fields the public may read, as the public sees them; empty when the
   * public may read none of the collection.
   */
  readonly readable: readonly BindingFieldShape[];
  /**
   * The collection's name as authors read it ("Posts"), for the words of a
   * finding; its slug stands in when absent.
   */
  readonly label?: string;
}

/**
 * Where a list's fields are looked up. `undefined` means the collection is
 * not known, and a list over it is judged by its shape alone.
 */
export interface ListFieldSource {
  fieldsOf(collection: string): ListFields | undefined;
}

/** What {@link listQueryIssues} judges with. */
export interface ListQueryJudgement {
  /** The schema; absent, lists are judged by their shape and nesting only. */
  readonly fields?: ListFieldSource;
  /**
   * The collection of the entry the page shows, for an `entry` relation.
   * `null` when the page is known to be no collection's entry (a Single's),
   * whose renderer has no entry to read a relation of, so such a list is
   * refused; absent when the page is not known, and such a list is judged by
   * its shape alone.
   */
  readonly entryCollection?: string | null;
  /**
   * The document's stored forms. A problem one of them already holds, on the
   * same block, is a warning rather than an error: a list stored before a
   * field was removed or hidden must not make its page unsavable for a
   * change nobody made to it.
   */
  readonly stored?: readonly BlockDocument[];
  /** How many nodes to visit at most, as the rest of validation is bounded. */
  readonly maxNodes?: number;
}

/** One finding about a list, before its severity is decided. */
interface Finding {
  readonly path: string;
  readonly nodeId: string;
  readonly code: ListShapeCode | ListFieldCode;
  readonly message: string;
}

/** A list in the walk: its node's query, and where its entries come from. */
interface EnclosingList {
  readonly query: ListQuery;
}

/** The fields a field-bound part of the query names, each with its part. */
function namedFields(
  query: ListQuery
): { field: string; use: "filter" | "sort" }[] {
  return [
    ...query.filters.map(row => ({ field: row.field, use: "filter" as const })),
    ...query.sort.map(key => ({ field: key.field, use: "sort" as const })),
  ];
}

/**
 * The public's shape of a field a list names, or why the list may not name
 * it: a field the collection does not have, or one the public may not read.
 * The one place the two are told apart, for filters, sort keys and related
 * sources alike.
 */
function readableField(
  field: string,
  fields: ListFields,
  words: { readonly uses: string; readonly collection: string }
):
  | { readonly shape: BindingFieldShape }
  | { readonly code: ListFieldCode; readonly message: string } {
  const shape = fields.readable.find(candidate => candidate.name === field);
  if (shape !== undefined) return { shape };
  return fields.declared.has(field)
    ? {
        code: "list-field-protected",
        message: `This list ${words.uses} "${field}", which visitors can't see, so the entries shown would reveal its values. Choose a field visitors can see.`,
      }
    : {
        code: "list-field-unknown",
        message: `This list ${words.uses} "${field}", which ${words.collection} doesn't have. Choose another field.`,
      };
}

/** The finding about one field a filter or the sort names, if any. */
function namedFieldFinding(
  named: { readonly field: string; readonly use: "filter" | "sort" },
  fields: ListFields,
  collection: string
): { code: ListFieldCode; message: string } | undefined {
  const uses = named.use === "filter" ? "filters by" : "sorts by";
  const judged = readableField(named.field, fields, { uses, collection });
  if (!("shape" in judged)) return judged;
  if (judged.shape.hasMany !== true) {
    return kindFinding(named, listFieldKind(judged.shape));
  }
  // A field holding several values has no one value to order by, and its
  // operators read it as one value, so `in` on a has-many relation matches
  // nothing on any database rather than "includes any of".
  return named.use === "sort"
    ? {
        code: "list-field-unsortable",
        message: `This list sorts by "${named.field}", which holds more than one value, so it has no one value to order by.`,
      }
    : {
        code: "list-field-unfilterable",
        message: `This list filters by "${named.field}", which holds more than one value. A list cannot filter by such a field yet.`,
      };
}

/**
 * The finding about a field of one value a list names, by its kind: the
 * editor offers a filter only on a field with a kind (`listFieldKind`) and a
 * sort only on a sortable one (`listKindSortable`), and the save holds every
 * other writer to the same offer. Without it, a sort on a relation or a
 * filter on a time of day saves, and the reader refuses it or compares a
 * stored form no author chose.
 */
function kindFinding(
  named: { readonly field: string; readonly use: "filter" | "sort" },
  kind: ListFieldKind | undefined
): { code: ListFieldCode; message: string } | undefined {
  if (kind === undefined) {
    return named.use === "sort"
      ? {
          code: "list-field-unsortable",
          message: `This list sorts by "${named.field}", which holds a value a list cannot order by, such as a time of day, rich text or media. Choose another field.`,
        }
      : {
          code: "list-field-unfilterable",
          message: `This list filters by "${named.field}", which holds a value a list cannot compare, such as a time of day, rich text or media. Choose another field.`,
        };
  }
  if (named.use === "sort" && !listKindSortable(kind)) {
    return {
      code: "list-field-unsortable",
      message: `This list sorts by "${named.field}", which links to another entry, so it has no order an author could mean. Choose another field.`,
    };
  }
  return undefined;
}

/** The judgement of the fields a list filters and sorts by. */
function fieldFindings(
  query: ListQuery,
  fields: ListFields,
  at: (prop: ListQueryProp) => string,
  nodeId: string
): Finding[] {
  const found: Finding[] = [];
  const seen = new Set<string>();
  for (const named of namedFields(query)) {
    const key = `${named.use}\u0000${named.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const finding = namedFieldFinding(
      named,
      fields,
      fields.label ?? query.collection ?? ""
    );
    if (finding === undefined) continue;
    found.push({
      path: at(named.use === "filter" ? "filters" : "sort"),
      nodeId,
      ...finding,
    });
  }
  return found;
}

/**
 * The collection a field's entries are in, when the field is a to-many
 * relation to one collection: the fields a related list may show, and the
 * one test of it, asked by the judgement below and by an editor offering
 * related sources alike.
 */
export function listRelationTarget(
  shape: BindingFieldShape
): string | undefined {
  return (shape.type === "relationship" || shape.type === "upload") &&
    shape.hasMany === true &&
    typeof shape.relationTo === "string"
    ? shape.relationTo
    : undefined;
}

/**
 * The kinds of value a field holds, as a list's filter and sort offer it:
 * what decides the operators a filter row may use and the control its value
 * is chosen with.
 */
export const LIST_FIELD_KINDS = [
  "text",
  "number",
  "date",
  "choice",
  "boolean",
  "entry",
] as const;

/** One of {@link LIST_FIELD_KINDS}. */
export type ListFieldKind = (typeof LIST_FIELD_KINDS)[number];

/** Whether a value names one of {@link LIST_FIELD_KINDS}, as read off the wire. */
export function isListFieldKind(value: unknown): value is ListFieldKind {
  return (LIST_FIELD_KINDS as readonly unknown[]).includes(value);
}

/**
 * A field's kind as a list may filter by it, or `undefined` for one a list
 * offers no filter on: a field holding several values (whose operators read
 * it as one value, so it matches nothing), a time of day (stored on a
 * placeholder date, so a day compares nothing), and anything that is not one
 * scalar: rich text, media, a list, JSON, a container. Read from the
 * engine's binding vocabulary, the one place a field type's value is named.
 */
export function listFieldKind(
  shape: BindingFieldShape
): ListFieldKind | undefined {
  if (shape.hasMany === true || shape.timeOnly === true) return undefined;
  switch (bindingKindOf(shape)) {
    case "text":
    case "url":
      return "text";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "option":
      return "choice";
    case "reference":
      // One target, so the value is a bare id an entry picker can choose.
      return typeof shape.relationTo === "string" ? "entry" : undefined;
    default:
      return undefined;
  }
}

/**
 * The operators a filter on a field of each kind may use. Contains only on
 * text, an order only on a number or a date, and a date has no "equals"
 * until a day can be compared for equality whatever time the field holds.
 * The one table of it: the save refuses any other, and an editor offers
 * exactly these.
 */
export const LIST_KIND_OPS: Readonly<
  Record<ListFieldKind, readonly ListFilterOp[]>
> = {
  text: ["equals", "not_equals", "contains", "in", "not_in", "exists"],
  number: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_equal",
    "less_than",
    "less_than_equal",
    "exists",
  ],
  date: [
    "greater_than",
    "greater_than_equal",
    "less_than",
    "less_than_equal",
    "exists",
  ],
  choice: ["equals", "not_equals", "in", "not_in", "exists"],
  boolean: ["equals"],
  entry: ["equals", "not_equals", "in", "not_in", "exists"],
};

/** What a kind is called in a finding's words. */
const KIND_WORDS: Readonly<Record<ListFieldKind, string>> = {
  text: "a text field",
  number: "a number field",
  date: "a date field",
  choice: "a choice field",
  boolean: "a yes-or-no field",
  entry: "a related-entry field",
};

/** What a field of one kind holds, and what to choose for it, in words. */
interface KindNeed {
  readonly holds: string;
  readonly choose: string;
}

/** Whether an operator compares an order. */
function ordersValues(op: ListFilterOp): boolean {
  return (
    op === "greater_than" ||
    op === "greater_than_equal" ||
    op === "less_than" ||
    op === "less_than_equal"
  );
}

/**
 * What a value must be for an operator on a field of each kind, beyond what
 * the operator itself takes: an order on a date compares a day, an order on
 * a number a number, and a yes-or-no field a yes or no. A kind not named
 * here takes any value its operators take.
 */
const KIND_VALUE_RULES: Readonly<
  Partial<
    Record<
      ListFieldKind,
      {
        readonly applies: (op: ListFilterOp) => boolean;
        readonly fits: (value: unknown) => boolean;
        readonly need: KindNeed;
      }
    >
  >
> = {
  date: {
    applies: ordersValues,
    fits: isListDay,
    need: { holds: "a date", choose: "a day, written YYYY-MM-DD" },
  },
  // Every operator but `exists` compares the number with the value, so
  // each takes a number (a list of them for membership): text or a yes or
  // no is compared, or refused, differently by each database.
  number: {
    applies: op => op !== "exists",
    fits: value =>
      typeof value === "number" ||
      (Array.isArray(value) && value.every(each => typeof each === "number")),
    need: { holds: "a number", choose: "a number" },
  },
  boolean: {
    applies: () => true,
    fits: value => typeof value === "boolean",
    need: { holds: "yes or no", choose: "yes or no" },
  },
};

/** What a value must be for `op` on a field of `kind`, when it is not that. */
function kindValueNeed(
  kind: ListFieldKind,
  op: ListFilterOp,
  value: unknown
): KindNeed | undefined {
  const rule = KIND_VALUE_RULES[kind];
  return rule === undefined || !rule.applies(op) || rule.fits(value)
    ? undefined
    : rule.need;
}

/**
 * A stored value as a finding names it: text quoted, so the text "5" is not
 * read as the number 5.
 */
function valueWords(value: unknown): string {
  return typeof value === "string"
    ? `"${describeValue(value)}"`
    : describeValue(value);
}

/**
 * Why a filter row does not suit its field's kind, or nothing when it does:
 * an operator the kind does not take, or a value of the wrong sort for it.
 * Without this, a day-shaped value on a text field would be read as a date
 * and compared as an instant, which is not the comparison stored.
 */
function kindProblem(
  row: ListFilter,
  index: number,
  kind: ListFieldKind
): string | undefined {
  const where = `Filter ${String(index + 1)} compares "${row.field}"`;
  if (!LIST_KIND_OPS[kind].includes(row.op)) {
    return `${where} with "${row.op}", which ${KIND_WORDS[kind]} doesn't take.`;
  }
  const need = kindValueNeed(kind, row.op, row.value);
  return need === undefined
    ? undefined
    : `${where}, which holds ${need.holds}, with ${valueWords(row.value)}. Choose ${need.choose}.`;
}

/**
 * The judgement of each filter row against its field's kind. A field not
 * found, not readable or holding several values is judged by
 * {@link fieldFindings} instead, and one with no kind a list filters by is
 * left to the reader.
 */
function kindFindings(
  query: ListQuery,
  fields: ListFields,
  at: (prop: ListQueryProp) => string,
  nodeId: string
): Finding[] {
  return query.filters.flatMap((row, index) => {
    const shape = fields.readable.find(
      candidate => candidate.name === row.field
    );
    const kind = shape === undefined ? undefined : listFieldKind(shape);
    const message =
      kind === undefined ? undefined : kindProblem(row, index, kind);
    return message === undefined
      ? []
      : [
          {
            path: at("filters"),
            nodeId,
            code: "list-filter-unsuited" as const,
            message,
          },
        ];
  });
}

/**
 * Whether a list may sort by a field of this kind. A relation orders by its
 * stored id, which says nothing an author could mean, so it filters only.
 */
export function listKindSortable(kind: ListFieldKind): boolean {
  return kind !== "entry";
}

/** Where a related list's relation field lives, or why it has none. */
function relationSource(
  relation: ListRelation,
  outer: EnclosingList | undefined,
  judgement: ListQueryJudgement
):
  | { collection: string | undefined }
  | {
      problem: string;
      code:
        | "list-relation-invalid"
        | "list-too-deep"
        | "list-relation-no-entry";
    } {
  if (relation.of === "entry") {
    if (judgement.entryCollection === null) {
      return {
        problem:
          "This page isn't an entry in a collection, so it has no related entries to show. Choose a collection.",
        code: "list-relation-no-entry",
      };
    }
    return { collection: judgement.entryCollection };
  }
  if (outer === undefined) {
    return {
      problem:
        "This list shows related entries of the outer item, but it is not inside another list. Choose a collection, or move this list into a list.",
      code: "list-relation-invalid",
    };
  }
  if (outer.query.relation !== undefined) {
    return {
      problem: `Too deep for a related field. This list is inside a list that already shows each ${outer.query.relation.of === "entry" ? "entry's" : "item's"} ${outer.query.relation.field}, and related entries go one level deep. Choose a collection, or move this list out of that list.`,
      code: "list-too-deep",
    };
  }
  return { collection: outer.query.collection };
}

/**
 * Why a related list's relation field cannot be its source, judged against
 * the fields of the collection it lives in; nothing when it can be.
 */
function relationFieldProblem(
  query: ListQuery,
  relation: ListRelation,
  fields: ListFields,
  source: string,
  nameOf: (collection: string) => string
): { prop: ListQueryProp; code: ListFieldCode; message: string } | undefined {
  const judged = readableField(relation.field, fields, {
    uses: "shows the entries of",
    collection: nameOf(source),
  });
  if (!("shape" in judged)) return { prop: "relation", ...judged };
  const target = listRelationTarget(judged.shape);
  if (target === undefined) {
    return {
      prop: "relation",
      code: "list-relation-unsuitable",
      message: `"${relation.field}" is not a relation holding several entries of one collection, so a list cannot show its entries.`,
    };
  }
  if (target !== query.collection) {
    return {
      prop: "collection",
      code: "list-relation-unsuitable",
      message: `"${relation.field}" holds entries of ${nameOf(target)}, not of ${query.collection === undefined ? "the list's collection" : nameOf(query.collection)}. Choose the list's source again.`,
    };
  }
  return undefined;
}

/** The judgement of a list's related source: where it sits, and its field. */
function relationFindings(
  query: ListQuery,
  outer: EnclosingList | undefined,
  judgement: ListQueryJudgement,
  at: (prop: ListQueryProp) => string,
  nodeId: string
): Finding[] {
  const relation = query.relation;
  if (relation === undefined) return [];
  const source = relationSource(relation, outer, judgement);
  if ("problem" in source) {
    return [
      {
        path: at("relation"),
        nodeId,
        code: source.code,
        message: source.problem,
      },
    ];
  }
  const fields =
    source.collection === undefined
      ? undefined
      : judgement.fields?.fieldsOf(source.collection);
  if (fields === undefined || source.collection === undefined) return [];
  // Each collection by the name authors read it by, its slug standing in.
  const nameOf = (collection: string) =>
    judgement.fields?.fieldsOf(collection)?.label ?? collection;
  const problem = relationFieldProblem(
    query,
    relation,
    fields,
    source.collection,
    nameOf
  );
  return problem === undefined
    ? []
    : [
        {
          path: at(problem.prop),
          nodeId,
          code: problem.code,
          message: problem.message,
        },
      ];
}

/** Everything found about one list node. */
function findingsFor(
  node: Readonly<Record<string, unknown>>,
  path: string,
  outer: EnclosingList | undefined,
  judgement: ListQueryJudgement
): { findings: Finding[]; list: EnclosingList } {
  const { query, problems } = readListQuery(node.props);
  const at = (prop: ListQueryProp) => pointer(`${path}/props`, prop);
  const nodeId = typeof node.id === "string" ? node.id : "";
  const findings: Finding[] = problems.map(problem => ({
    path: at(problem.prop),
    nodeId,
    code: problem.code,
    message: problem.message,
  }));
  findings.push(...relationFindings(query, outer, judgement, at, nodeId));
  const fields =
    query.collection === undefined || judgement.fields === undefined
      ? undefined
      : judgement.fields.fieldsOf(query.collection);
  if (fields !== undefined) {
    findings.push(...fieldFindings(query, fields, at, nodeId));
    findings.push(...kindFindings(query, fields, at, nodeId));
  }
  return { findings, list: { query } };
}

/** One node on the walk's stack, with the list it sits in. */
interface Visit {
  readonly node: unknown;
  readonly path: string;
  readonly outer: EnclosingList | undefined;
}

/** Push a slot's children onto the walk's stack, first child on top. */
function pushChildren(
  stack: Visit[],
  list: readonly unknown[],
  base: string,
  outer: EnclosingList | undefined
): void {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    stack.push({ node: list[index], path: pointer(base, index), outer });
  }
}

/**
 * Push each slot of a visited node, with the list whose entry is the item
 * there: `entryScope` (the node's own list, when it is one) in the slot a
 * list draws per entry, and the list around the node everywhere else, since
 * a list's other slots are drawn with the item around the list itself.
 */
function pushSlots(
  stack: Visit[],
  visit: Visit & { readonly node: Readonly<Record<string, unknown>> },
  entryScope: EnclosingList | undefined
): void {
  const slots = visit.node.slots;
  if (!isPlainRecord(slots)) return;
  for (const name of Object.keys(slots).reverse()) {
    const children = slots[name];
    if (!Array.isArray(children)) continue;
    pushChildren(
      stack,
      children,
      pointer(`${visit.path}/slots`, name),
      name === LIST_ENTRY_SLOT ? entryScope : visit.outer
    );
  }
}

/**
 * Every finding about the lists in a forest, in document order. Iterative,
 * bounded by `maxNodes`, and reading only plain records, because a stored
 * document is whatever the database returned.
 */
function walkFindings(
  nodes: readonly unknown[],
  judgement: ListQueryJudgement
): Finding[] {
  const findings: Finding[] = [];
  const budget = { left: judgement.maxNodes ?? Number.MAX_SAFE_INTEGER };
  const stack: Visit[] = [];
  pushChildren(stack, nodes, "/nodes", undefined);
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const { node, path } = visit;
    if (!isPlainRecord(node)) continue;
    let entryScope = visit.outer;
    if (node.type === COLLECTION_LIST_TYPE) {
      const judged = findingsFor(node, path, visit.outer, judgement);
      findings.push(...judged.findings);
      entryScope = judged.list;
    }
    pushSlots(stack, { ...visit, node }, entryScope);
  }
  return findings;
}

/**
 * The problems of every list in a document, as validation issues.
 *
 * Its shape is always judged: the bounds of `limit` and `offset`, each
 * filter row, the sort, the related source and how deep related lists nest.
 * The fields it names are judged when `judgement.fields` is given: one the
 * collection does not have, one the public may not read, a list-valued sort
 * key, and a related source that is not a to-many relation to the list's
 * collection. Each is an error, except one a stored form already held on
 * the same block, which is a warning.
 */
export function listQueryIssues(
  nodes: readonly unknown[],
  judgement: ListQueryJudgement = {}
): {
  readonly path: string;
  /** The list block the issue is about, so an editor shows it on that block. */
  readonly nodeId: string;
  readonly code: ListShapeCode | ListFieldCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}[] {
  return withHeldSeverity(
    walkFindings(nodes, judgement),
    judgement.stored,
    forest => walkFindings(forest, judgement)
  );
}

/**
 * The codes only the schema or the page's host can decide, so a caller
 * judging twice can tell them apart.
 */
export const LIST_FIELD_CODES: ReadonlySet<string> = new Set<ListFieldCode>([
  "list-field-unknown",
  "list-field-protected",
  "list-field-unsortable",
  "list-field-unfilterable",
  "list-filter-unsuited",
  "list-relation-unsuitable",
  "list-relation-no-entry",
]);
