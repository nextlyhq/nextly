/**
 * What a collection list's query is made of: the block and slot a list
 * belongs to, the filter operators, the filter, sort, relation and custom
 * source shapes, the bounds a query is held to, and the issue codes its
 * problems are reported under.
 *
 * @module list-query-contract
 */
import type { BlockNode } from "./document";
import type { NamedQueryParamValue } from "./named-query";
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
 * answer, as `listQueryIssues` judges a related list's outer item, for
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
    if (drawsItsEntry(parent, at.slot)) return parent;
    at = locateNode(nodes, parent.id);
  }
  return undefined;
}

/**
 * Whether what sits in `slot` of `parent` has that list's entry as its
 * item: only a list's per-entry slot draws one. The rule
 * {@link outerListOf} walks by, for a walk down a tree to keep the same
 * answer.
 */
export function drawsItsEntry(
  parent: { type?: unknown },
  slot: string | undefined
): boolean {
  return parent.type === COLLECTION_LIST_TYPE && slot === LIST_ENTRY_SLOT;
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

/** A list's custom source: a registered query's name and its inputs. */
export interface ListNamedQuery {
  readonly name: string;
  /** One literal per input set; an empty optional input is absent. */
  readonly params: Readonly<Record<string, NamedQueryParamValue>>;
}

/** A list's query as stored, each part present only when it was stored well. */
export interface ListQuery {
  /** The collection read, trimmed; absent when none is named. */
  readonly collection?: string;
  readonly relation?: ListRelation;
  /** A custom source, in place of a collection. */
  readonly namedQuery?: ListNamedQuery;
  readonly filters: readonly ListFilter[];
  readonly sort: readonly ListSortKey[];
  readonly limit?: number;
  readonly offset?: number;
  /**
   * Present, and true, when the list is split into pages, each served at
   * its own address (`/news/page/2`); absent when it shows one page.
   */
  readonly paginate?: true;
}

/** The props a stored list query is read from. */
export type ListQueryProp =
  | "collection"
  | "relation"
  | "filters"
  | "sort"
  | "limit"
  | "offset"
  | "namedQuery"
  | "paginate";

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
  | "list-relation-invalid"
  | "list-named-query-invalid"
  | "list-source-conflict"
  | "list-paginate-invalid";

/** The codes a list is refused with when judged against the schema. */
export type ListFieldCode =
  | "list-field-unknown"
  | "list-field-protected"
  | "list-field-unsortable"
  | "list-field-unfilterable"
  | "list-filter-unsuited"
  | "list-relation-unsuitable"
  | "list-relation-no-entry"
  | "list-too-deep"
  | "list-named-query-unknown"
  | "list-named-query-param-missing"
  | "list-named-query-param-invalid"
  | "list-named-query-param-unknown"
  | "list-named-query-reads-hidden"
  | "list-named-query-rows-hidden"
  | "list-named-query-uncounted";

/**
 * The codes a split into pages is refused with, by where the list sits: a
 * page has one list that pages, and it must be one that can.
 */
export type ListPageCode =
  | "list-paginate-twice"
  | "list-paginate-nested"
  | "list-paginate-related"
  | "list-paginate-shared";

/** Every code a list query is judged with, each described for authors. */
export const LIST_ISSUE_CODES: {
  readonly [Code in ListShapeCode | ListFieldCode | ListPageCode]: string;
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
  "list-named-query-invalid":
    "A list's custom source is not a query's name and a record of input values.",
  "list-source-conflict":
    "A list's custom source sits beside a collection, related entries, filters or sort.",
  "list-named-query-unknown":
    "A list's custom source names a query this site does not register.",
  "list-named-query-param-missing":
    "A list's custom source leaves out an input its query needs.",
  "list-named-query-param-invalid":
    "A list's custom source holds an input value its query does not take.",
  "list-named-query-param-unknown":
    "A list's custom source holds an input its query no longer declares.",
  "list-named-query-reads-hidden":
    "A list's custom source reads a collection visitors cannot read.",
  "list-named-query-rows-hidden":
    "A list's custom source lists entries of a collection visitors cannot read.",
  "list-named-query-uncounted":
    "A list split into pages has a custom source that does not count its entries.",
  "list-paginate-invalid":
    "A list's split into pages is not stored as on or off.",
  "list-paginate-twice": "More than one list on a page is split into pages.",
  "list-paginate-nested": "A list split into pages sits inside another list.",
  "list-paginate-related":
    "A list split into pages shows related entries, which have no count of pages.",
  "list-paginate-shared":
    "A list split into pages sits in a component or a Layout region, which shows on many pages.",
};
