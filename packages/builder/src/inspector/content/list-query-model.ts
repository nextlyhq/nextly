/**
 * A collection list's query as its inspector reads, words and writes it.
 *
 * What is STORED is the engine's: `readListQuery` is the one reading of a
 * list's props, `listSortText` writes the sort back in the spelling it
 * reads, and `listQueryIssues` judges what a save would. This module adds
 * only what an editor needs on top of that, and nothing the engine decides:
 *
 * - which operators an author is offered for a field of each kind, and what
 *   each is called ("is on or after" for a date's `greater_than_equal`);
 * - what a sort's direction is called for a field of each kind ("Newest
 *   first" for a date, "A–Z" for text);
 * - a filter row as one sentence ("Category is any of News, Guides");
 * - the edits a row, a key or a bound makes to the stored props, each one
 *   change of the props, so an action is one undo step.
 *
 * Pure, so each rule is tested without a panel.
 *
 * @module list-query-model
 */
import {
  LIST_KIND_OPS,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  listSortText,
  readListQuery,
  type ListFieldKind,
  type ListFilter,
  type ListFilterOp,
  type ListFilterScalar,
  type ListSortKey,
} from "@nextlyhq/blocks-engine";

/** One field a list may filter by, as the host's list names it. */
export interface QueryField {
  readonly name: string;
  readonly label: string;
  readonly kind: ListFieldKind;
  /** A choice field's choices, as stored and as named. */
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  /** The collection an entry field points at. */
  readonly relationTo?: string;
}

/**
 * One operator an author picks: the stored operator, and for `exists` which
 * way it points, since "has a value" and "is empty" are one operator with a
 * value of `true` or `false`.
 */
export interface OperatorChoice {
  /** What keys it in a menu: the operator, or `exists:true` / `exists:false`. */
  readonly key: string;
  readonly op: ListFilterOp;
  /** The value an `exists` choice stores. */
  readonly exists?: boolean;
  readonly label: string;
}

const HAS_VALUE: OperatorChoice = {
  key: "exists:true",
  op: "exists",
  exists: true,
  label: "has a value",
};
const IS_EMPTY: OperatorChoice = {
  key: "exists:false",
  op: "exists",
  exists: false,
  label: "is empty",
};

/** What each operator but `exists` is called, as a number's order is worded. */
const OPERATOR_LABELS: Readonly<
  Record<Exclude<ListFilterOp, "exists">, string>
> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  in: "is any of",
  not_in: "is none of",
  greater_than: "is more than",
  greater_than_equal: "is at least",
  less_than: "is less than",
  less_than_equal: "is at most",
};

/** A date's order, worded as days: "is after", "is on or before". */
const DATE_LABELS: Readonly<Partial<Record<ListFilterOp, string>>> = {
  greater_than: "is after",
  greater_than_equal: "is on or after",
  less_than: "is before",
  less_than_equal: "is on or before",
};

/** The choices for a field of `kind`: the engine's operators, each worded. */
function choicesFor(kind: ListFieldKind): readonly OperatorChoice[] {
  return LIST_KIND_OPS[kind].flatMap(op =>
    op === "exists"
      ? [HAS_VALUE, IS_EMPTY]
      : [
          {
            key: op,
            op,
            label:
              (kind === "date" ? DATE_LABELS[op] : undefined) ??
              OPERATOR_LABELS[op],
          },
        ]
  );
}

/**
 * The operators offered for a field of each kind, in menu order: exactly
 * the engine's `LIST_KIND_OPS`, which the save judges a row by, so the menu
 * never offers a row the save refuses. `exists` is offered both ways, as
 * "has a value" and "is empty".
 */
export const OPERATORS: Readonly<
  Record<ListFieldKind, readonly OperatorChoice[]>
> = {
  text: choicesFor("text"),
  number: choicesFor("number"),
  date: choicesFor("date"),
  choice: choicesFor("choice"),
  boolean: choicesFor("boolean"),
  entry: choicesFor("entry"),
};

/** The menu key a stored row's operator is listed under. */
function operatorKey(op: ListFilterOp, value: unknown): string {
  return op === "exists" ? `exists:${String(value === true)}` : op;
}

/** A stored row's operator as offered for `kind`, if it is one offered. */
export function operatorOf(
  kind: ListFieldKind,
  op: ListFilterOp,
  value: unknown
): OperatorChoice | undefined {
  const key = operatorKey(op, value);
  return OPERATORS[kind].find(choice => choice.key === key);
}

/** Whether an operator takes a list of values: is any of, is none of. */
export function takesList(op: ListFilterOp): boolean {
  return op === "in" || op === "not_in";
}

/** What a sort's two directions are called, for a field of each kind. */
const DIRECTION_WORDS: Readonly<
  Record<
    ListFieldKind,
    { readonly ascending: string; readonly descending: string }
  >
> = {
  date: { ascending: "Oldest first", descending: "Newest first" },
  text: { ascending: "A–Z", descending: "Z–A" },
  choice: { ascending: "A–Z", descending: "Z–A" },
  number: { ascending: "Lowest first", descending: "Highest first" },
  boolean: { ascending: "No first", descending: "Yes first" },
  entry: { ascending: "Ascending", descending: "Descending" },
};

/** The words for a key's directions, plain where its field is not known. */
export function directionWords(kind: ListFieldKind | undefined): {
  readonly ascending: string;
  readonly descending: string;
} {
  return kind === undefined
    ? { ascending: "Ascending", descending: "Descending" }
    : DIRECTION_WORDS[kind];
}

/**
 * The direction a newly chosen field sorts in: newest first for a date, as a
 * list of posts is most often read, and ascending for anything else.
 */
export function firstDirection(kind: ListFieldKind): boolean {
  return kind === "date";
}

/** A day as an author reads it: "1 Sept 2026". The stored day, never shifted. */
export function dayWords(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1)));
}

/** "A, B" or "A, B and 2 more": a list of values on one short line. */
function listWords(words: readonly string[], shown = 2): string {
  if (words.length <= shown + 1) return words.join(", ");
  return `${words.slice(0, shown).join(", ")} and ${String(words.length - shown)} more`;
}

/** How a value is said for a field of each kind. */
const VALUE_WORDS: Readonly<
  Record<
    ListFieldKind,
    (
      value: ListFilterScalar,
      field: QueryField,
      entryTitle: (id: string) => string | undefined
    ) => string
  >
> = {
  boolean: value => (value === true ? "Yes" : "No"),
  choice: (value, field) =>
    field.options?.find(option => option.value === value)?.label ??
    String(value),
  entry: (value, _field, entryTitle) => entryTitle(String(value)) ?? "an entry",
  date: value => (typeof value === "string" ? dayWords(value) : String(value)),
  text: value => (typeof value === "string" ? `“${value}”` : String(value)),
  number: value => String(value),
};

/** One value as an author reads it, for a field of its kind. */
function valueWords(
  value: ListFilterScalar,
  field: QueryField | undefined,
  entryTitle: (id: string) => string | undefined
): string {
  return field === undefined
    ? String(value)
    : VALUE_WORDS[field.kind](value, field, entryTitle);
}

/** A filter row as one sentence, in its three parts. */
export interface FilterSentence {
  /** The field: its label, or its stored name marked as gone. */
  readonly field: string;
  /** The operator, as the field's kind words it. */
  readonly operator: string;
  /** The value, or nothing for an operator that takes none. */
  readonly value: string;
}

/** A row as the closed line reads it: "Category · is any of · News, Guides". */
export function filterSentence(
  row: {
    readonly field?: string;
    readonly op?: ListFilterOp;
    readonly value?: unknown;
  },
  field: QueryField | undefined,
  entryTitle: (id: string) => string | undefined = () => undefined
): FilterSentence {
  const fieldWords =
    row.field === undefined
      ? "Choose a field"
      : (field?.label ?? `${row.field} (removed)`);
  if (row.op === undefined) {
    return { field: fieldWords, operator: "", value: "" };
  }
  const operator =
    (field === undefined
      ? undefined
      : operatorOf(field.kind, row.op, row.value)
    )?.label ?? row.op.replaceAll("_", " ");
  if (row.op === "exists") return { field: fieldWords, operator, value: "" };
  const values = Array.isArray(row.value) ? row.value : [row.value];
  const scalars = values.filter(
    (value): value is ListFilterScalar =>
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
  );
  return {
    field: fieldWords,
    operator,
    value:
      scalars.length === 0
        ? "no value"
        : listWords(scalars.map(value => valueWords(value, field, entryTitle))),
  };
}

/** A row as one line of text, for its title and accessible name. */
export function filterLine(sentence: FilterSentence): string {
  return [sentence.field, sentence.operator, sentence.value]
    .filter(part => part !== "")
    .join(" ");
}

/** A row being edited: any part may be missing until the author chooses it. */
export interface DraftFilter {
  readonly field?: string;
  readonly op?: ListFilterOp;
  readonly value?: unknown;
}

/**
 * A draft row as the stored row it would be, or why it is not one yet, in
 * words naming what to choose. Judged by the engine's own reading of a
 * filter row, so a row the editor writes is one the save accepts.
 */
export function completedFilter(
  draft: DraftFilter,
  field: QueryField | undefined
): { readonly filter: ListFilter } | { readonly missing: string } {
  if (draft.field === undefined || field === undefined) {
    return { missing: "Choose a field, or remove this filter." };
  }
  if (draft.op === undefined) {
    return { missing: "Choose how to compare, or remove this filter." };
  }
  const read = readListQuery({
    filters: [{ field: draft.field, op: draft.op, value: draft.value }],
  });
  const filter = read.query.filters[0];
  if (filter !== undefined && read.problems.length === 0) return { filter };
  const what =
    field.kind === "entry"
      ? `an entry`
      : field.kind === "choice"
        ? "a choice"
        : field.kind === "date"
          ? "a day"
          : "a value";
  return {
    missing: `Choose ${what} for ${field.label}, or remove this filter.`,
  };
}

/**
 * The value a row starts with when its field or operator changes: what the
 * new operator takes, kept from the old value where it still fits, so
 * changing "is" to "is any of" keeps the chosen value as the first of a list.
 */
export function valueFor(
  kind: ListFieldKind,
  choice: OperatorChoice,
  previous: unknown
): unknown {
  if (choice.op === "exists") return choice.exists === true;
  if (kind === "boolean") return previous === false ? false : true;
  const first = Array.isArray(previous) ? previous[0] : previous;
  if (takesList(choice.op)) {
    if (Array.isArray(previous)) return previous;
    return first === undefined || first === "" ? [] : [first];
  }
  return first;
}

/** The stored filters with one row replaced, added or removed. */
export function withFilter(
  filters: readonly ListFilter[],
  index: number,
  next: ListFilter | undefined
): ListFilter[] | undefined {
  const rows =
    next === undefined
      ? filters.filter((_, at) => at !== index)
      : index >= filters.length
        ? [...filters, next]
        : filters.map((row, at) => (at === index ? next : row));
  // No rows removes the prop, so a list with no filters stores none.
  return rows.length === 0 ? undefined : rows;
}

/** The stored keys with one moved from `from` to `to`, others in order. */
export function movedKey(
  keys: readonly ListSortKey[],
  from: number,
  to: number
): ListSortKey[] {
  if (from === to || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/** The sort as stored for `keys`: `undefined` for none, which removes it. */
export function sortValue(keys: readonly ListSortKey[]): string | undefined {
  return listSortText(keys);
}

/**
 * A typed bound read as the number it stores, or the message saying what to
 * type instead, judged by the engine's own reading of the prop so the field
 * and the save agree. Empty removes the prop, and the list reads its default.
 */
export function readBound(
  prop: "limit" | "offset",
  typed: string
): { readonly value: number | undefined } | { readonly problem: string } {
  const text = typed.trim();
  if (text === "") return { value: undefined };
  const parsed = Number(text);
  const read = readListQuery({ [prop]: Number.isNaN(parsed) ? text : parsed });
  const problem = read.problems.find(each => each.prop === prop);
  if (problem === undefined) return { value: read.query[prop] };
  return {
    problem:
      prop === "limit"
        ? `Show between ${String(LIST_LIMIT_MIN)} and ${String(LIST_LIMIT_MAX)} entries.`
        : "Skip a whole number of entries, 0 or more.",
  };
}
