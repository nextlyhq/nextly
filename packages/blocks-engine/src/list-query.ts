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
 * - `namedQuery`: a custom source, `{ name, params }`: a query a developer
 *   registered in code, and a typed literal for each of its inputs. It is
 *   the list's whole source, so `collection`, `relation`, `filters` and
 *   `sort` are absent beside it: a reader that predates it then sees a list
 *   with no source, never an unfiltered collection.
 *
 * Which fields a list may name is a question about the schema and about who
 * may read it, so it is asked of a `ListFieldSource` the caller
 * supplies: the engine reads no storage. A list's filter or sort may use only
 * fields the public may read, since which entries show, and in what order,
 * would otherwise reveal a field no visitor may see.
 *
 * ## The complexity suppressions in this module's parts
 *
 * Two functions in `list-query-pages` carry `fallow-ignore-next-line
 * complexity`: `idsInsideLists` and `paginatedList`. They moved there
 * unchanged, apart from an `export`, when this module was split into parts,
 * and their scores were inherited, so ungated, while they sat here. The audit
 * calls them new only because their file is new, and the health baseline is
 * generated from `main`, never from a branch. Suppressed inline, one by one,
 * as `ops.ts` and `validation.ts` do for theirs: a new complex function added
 * to any part still gets caught.
 *
 * @module list-query
 */
import { withHeldSeverity } from "./held-findings";
import { pointer } from "./issue-text";
import {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  type ListFieldCode,
  type ListPageCode,
  type ListQuery,
  type ListQueryProp,
  type ListShapeCode,
} from "./list-query-contract";
import {
  type EnclosingList,
  fieldFindings,
  type Finding,
  kindFindings,
  type ListQueryJudgement,
} from "./list-query-fields";
import { namedFindings } from "./list-query-named";
import {
  idsInsideLists,
  paginatedList,
  type PaginatedList,
} from "./list-query-pages";
import { readListQuery } from "./list-query-read";
import { relationFindings } from "./list-query-relations";
import { isPlainRecord } from "./plain-record";

export {
  COLLECTION_LIST_TYPE,
  LIST_ENTRY_SLOT,
  LIST_FILTER_OPS,
  LIST_ISSUE_CODES,
  LIST_LIMIT_MAX,
  LIST_LIMIT_MIN,
  LIST_MAX_FILTERS,
  LIST_MAX_SORT_KEYS,
  LIST_MAX_SORT_LENGTH,
  LIST_MAX_VALUES,
  outerListOf,
} from "./list-query-contract";
export type {
  ListFieldCode,
  ListFilter,
  ListFilterOp,
  ListFilterScalar,
  ListNamedQuery,
  ListPageCode,
  ListQuery,
  ListQueryProblem,
  ListQueryProp,
  ListRelation,
  ListShapeCode,
  ListSortKey,
} from "./list-query-contract";
export {
  isListDay,
  isListFieldName,
  isListFilterOp,
  listDayAfter,
  listSortText,
  namesListSource,
  readListQuery,
} from "./list-query-read";
export {
  listPageCount,
  mayPaginateList,
  paginatedList,
} from "./list-query-pages";
export type { PaginatedList } from "./list-query-pages";
export {
  LIST_FIELD_KINDS,
  LIST_KIND_OPS,
  isListFieldKind,
  listFieldKind,
  listKindSortable,
  listRelationTarget,
} from "./list-query-fields";
export type {
  ListFieldKind,
  ListFieldSource,
  ListFields,
  ListQueryJudgement,
} from "./list-query-fields";
export { listItemRef, namedQueryHiddenReads } from "./list-query-named";
export type { NamedQueryHiddenRead } from "./list-query-named";

/** Where each kind of shared document shows, for the words of a refusal. */
const SHOWN_ON_MANY: Readonly<Record<string, string>> = {
  component:
    "This list is in a component, which can be placed on many pages, so it can't be split into pages.",
  region:
    "This list is in a Layout region, which shows on every page using the Layout, so it can't be split into pages.",
};

/**
 * Why a list split into pages may not be: it sits where nothing has an
 * address of its own, it has no count of pages, or another list on the page
 * already pages. `paging` is the one list the page's address pages.
 */
function pageFindings(
  query: ListQuery,
  outer: EnclosingList | undefined,
  judgement: ListQueryJudgement,
  paging: PageOwner,
  at: (prop: ListQueryProp) => string,
  nodeId: string
): Finding[] {
  if (query.paginate !== true) return [];
  const refused = (code: ListPageCode, message: string): Finding[] => [
    { path: at("paginate"), nodeId, code, message },
  ];
  const shared =
    judgement.documentKind === undefined
      ? undefined
      : SHOWN_ON_MANY[judgement.documentKind];
  if (shared !== undefined) {
    return refused(
      "list-paginate-shared",
      `${shared} Turn off Split into pages.`
    );
  }
  // Inside another list in any slot: drawn once per outer entry, or, in its
  // empty state, only when the outer list has none.
  if (outer !== undefined || paging.insideLists.has(nodeId)) {
    return refused(
      "list-paginate-nested",
      "This list is split into pages, but it sits inside another list, which repeats it for each entry with no address of its own. Turn off Split into pages, or move this list out of that list."
    );
  }
  if (query.relation !== undefined) {
    return refused(
      "list-paginate-related",
      "This list shows related entries, which can't be split into pages. Show a collection instead, or turn off Split into pages."
    );
  }
  const owner = paging.list;
  if (owner !== undefined && owner.id !== nodeId) {
    const other =
      owner.name === undefined
        ? "another list on this page"
        : `"${owner.name}"`;
    return refused(
      "list-paginate-twice",
      `Only one list on a page can be split into pages, and ${other} already is. Turn off Split into pages on one of them.`
    );
  }
  return [];
}

/** The list a page's address pages, and the nodes no address can page. */
interface PageOwner {
  readonly list: PaginatedList | undefined;
  readonly insideLists: ReadonlySet<string>;
}

/** Everything found about one list node. */
function findingsFor(
  node: Readonly<Record<string, unknown>>,
  path: string,
  outer: EnclosingList | undefined,
  judgement: ListQueryJudgement,
  paging: PageOwner
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
  findings.push(...namedFindings(query, judgement, at, nodeId));
  findings.push(...pageFindings(query, outer, judgement, paging, at, nodeId));
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
  // The one list the page's address pages, as the route and renderer find
  // it, so every other list split into pages is judged against that one.
  const paging: PageOwner = {
    list: paginatedList(nodes, budget.left),
    insideLists: idsInsideLists(nodes, budget.left),
  };
  const stack: Visit[] = [];
  pushChildren(stack, nodes, "/nodes", undefined);
  for (let visit = stack.pop(); visit !== undefined; visit = stack.pop()) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const { node, path } = visit;
    if (!isPlainRecord(node)) continue;
    let entryScope = visit.outer;
    if (node.type === COLLECTION_LIST_TYPE) {
      const judged = findingsFor(node, path, visit.outer, judgement, paging);
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
 * the same block, which is a warning. A custom source's name and inputs are
 * judged when `judgement.namedQueries` is given, and so is whether its query
 * counts its rows where the list is split into pages; an input the query no
 * longer takes, and a declared read visitors cannot read, are always
 * warnings.
 */
export function listQueryIssues(
  nodes: readonly unknown[],
  judgement: ListQueryJudgement = {}
): {
  readonly path: string;
  /** The list block the issue is about, so an editor shows it on that block. */
  readonly nodeId: string;
  readonly code: ListShapeCode | ListFieldCode | ListPageCode;
  readonly message: string;
  readonly severity: "error" | "warning";
}[] {
  // An input the query no longer takes and a read visitors cannot read are
  // warnings whatever the stored forms hold.
  return withHeldSeverity(
    walkFindings(nodes, judgement),
    judgement.stored,
    forest => walkFindings(forest, judgement)
  ).map(issue =>
    ALWAYS_WARNINGS.has(issue.code) ? { ...issue, severity: "warning" } : issue
  );
}

/**
 * The codes that are warnings whatever the stored forms hold: an input the
 * query no longer takes, which is left out, and a declared read visitors
 * cannot read. In neither has the author done anything a save should refuse.
 */
const ALWAYS_WARNINGS: ReadonlySet<string> = new Set<ListFieldCode>([
  "list-named-query-param-unknown",
  "list-named-query-reads-hidden",
]);

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
  "list-named-query-unknown",
  "list-named-query-param-missing",
  "list-named-query-param-invalid",
  "list-named-query-param-unknown",
  "list-named-query-reads-hidden",
  "list-named-query-rows-hidden",
  "list-named-query-uncounted",
]);
