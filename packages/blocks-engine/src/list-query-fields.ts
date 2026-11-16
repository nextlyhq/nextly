/**
 * What a list's fields may do, judged against the schema a caller supplies:
 * the judgement's inputs, whether a field exists and the public may read it,
 * and what each kind of field can be filtered by and sorted on.
 *
 * @module list-query-fields
 */
import type { BindingFieldShape } from "./binding-rules";
import { bindingKindOf } from "./binding-vocabulary";
import type { BlockDocument } from "./document";
import { describeValue } from "./issue-text";
import type {
  ListFieldCode,
  ListFilter,
  ListFilterOp,
  ListPageCode,
  ListQuery,
  ListQueryProp,
  ListShapeCode,
} from "./list-query-contract";
import { isListDay } from "./list-query-read";
import type { NamedQuerySource } from "./named-query";

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

/** What `listQueryIssues` judges with. */
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
   * The named queries the site registers, for a list whose source is one.
   * Absent, such a list is judged by its shape alone; given, its name and
   * inputs are judged against the query's declaration, and, with
   * {@link fields}, whether visitors can read what it lists.
   */
  readonly namedQueries?: NamedQuerySource;
  /**
   * The document's stored forms. A problem one of them already holds, on the
   * same block, is a warning rather than an error: a list stored before a
   * field was removed or hidden must not make its page unsavable for a
   * change nobody made to it.
   */
  readonly stored?: readonly BlockDocument[];
  /** How many nodes to visit at most, as the rest of validation is bounded. */
  readonly maxNodes?: number;
  /**
   * What the document is (`page`, `component`, `region`, …). A component
   * or a Layout region shows on many pages, so no list in one may be split
   * into pages; absent, where its lists sit is not judged.
   */
  readonly documentKind?: string;
}

/** One finding about a list, before its severity is decided. */
export interface Finding {
  readonly path: string;
  readonly nodeId: string;
  readonly code: ListShapeCode | ListFieldCode | ListPageCode;
  readonly message: string;
}

/** A list in the walk: its node's query, and where its entries come from. */
export interface EnclosingList {
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
export function readableField(
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
export function fieldFindings(
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
 * one test of it, asked by the related-source judgement
 * (`relationFindings`, in `list-query-relations`) and by an editor offering
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
export function kindFindings(
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
