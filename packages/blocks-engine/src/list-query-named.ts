/**
 * A list's custom source: a registered query's name and inputs, the
 * collections it reads that visitors cannot, and the rows a published page
 * goes without.
 *
 * @module list-query-named
 */
import { pointer } from "./issue-text";
import type { ListQuery, ListQueryProp } from "./list-query-contract";
import type {
  Finding,
  ListFieldSource,
  ListQueryJudgement,
} from "./list-query-fields";
import {
  judgeNamedParams,
  NAMED_QUERY_TEXT,
  type NamedQueryDeclaration,
} from "./named-query";

/** A query's collection by the name authors read it by, its slug standing in. */
function collectionWords(
  judgement: ListQueryJudgement,
  collection: string
): string {
  return judgement.fields?.fieldsOf(collection)?.label ?? collection;
}

/**
 * Whether visitors can read nothing of a collection, as far as the schema
 * says: `false` when its fields are not known.
 */
function unreadable(
  judgement: ListQueryJudgement,
  collection: string
): boolean {
  const fields = judgement.fields?.fieldsOf(collection);
  return fields !== undefined && fields.readable.length === 0;
}

/** The fields every entry keeps, which say nothing about what is hidden. */
const ENTRY_KEPT: ReadonlySet<string> = new Set([
  "id",
  "createdAt",
  "updatedAt",
]);

/**
 * One collection a named query reads that visitors can read nothing of: its
 * name as authors read it, and the fields it declares, which a published
 * page's rows go without.
 *
 * @experimental
 */
export interface NamedQueryHiddenRead {
  readonly collection: string;
  readonly label: string;
  /** Its declared fields, the id and timestamps left out; none when unknown. */
  readonly fields: readonly string[];
}

/**
 * The schema a list's items bind against: the collection their entries are
 * of, where they are a collection's entries (an ordinary list's collection,
 * or a named query whose rows are that collection's entries); else the named
 * query's own declared rows; else none known. The one rule the render, the
 * save and the report of bindings to fix all read an item binding by.
 *
 * @experimental
 */
export function listItemRef(rows: {
  readonly collection?: string | undefined;
  readonly query?: string | undefined;
}): { readonly collection: string } | { readonly query: string } | undefined {
  if (typeof rows.collection === "string" && rows.collection !== "") {
    return { collection: rows.collection };
  }
  return typeof rows.query === "string" ? { query: rows.query } : undefined;
}

/**
 * The collections a named query declares it reads, other than the one its
 * rows are entries of, that visitors can read nothing of, as far as `fields`
 * knows: the one answer the save's warning, the editor's inspector and its
 * canvas share. A collection `fields` does not know is left out.
 *
 * @experimental
 */
export function namedQueryHiddenReads(
  declaration: NamedQueryDeclaration,
  fields: ListFieldSource
): NamedQueryHiddenRead[] {
  const rows = declaration.rows;
  const rowsCollection = "collection" in rows ? rows.collection : undefined;
  const hidden: NamedQueryHiddenRead[] = [];
  for (const read of declaration.reads.collections ?? []) {
    if (read === rowsCollection) continue;
    const known = fields.fieldsOf(read);
    if (known === undefined || known.readable.length > 0) continue;
    hidden.push({
      collection: read,
      label: known.label ?? read,
      fields: [...known.declared].filter(name => !ENTRY_KEPT.has(name)),
    });
  }
  return hidden;
}

/**
 * The judgement of a list's custom source against its query's declaration:
 * a name nothing registers, each input missing, not fitting or no longer
 * declared, a list split into pages whose query does not count its rows,
 * and, where the schema is known, a query whose rows visitors can never read
 * or that reads a collection they cannot.
 */
export function namedFindings(
  query: ListQuery,
  judgement: ListQueryJudgement,
  at: (prop: ListQueryProp) => string,
  nodeId: string
): Finding[] {
  const named = query.namedQuery;
  const source = judgement.namedQueries;
  if (named === undefined || source === undefined) return [];
  const declaration = source.declarationOf(named.name);
  if (declaration === undefined) {
    return [
      {
        path: at("namedQuery"),
        nodeId,
        code: "list-named-query-unknown",
        message: NAMED_QUERY_TEXT.unknown(named.name),
      },
    ];
  }
  const inputAt = (key: string) =>
    pointer(pointer(at("namedQuery"), "params"), key);
  const judged = judgeNamedParams(declaration, named.params);
  const found: Finding[] = [
    ...judged.problems.map(problem => ({
      path: inputAt(problem.param),
      nodeId,
      code:
        problem.kind === "missing"
          ? ("list-named-query-param-missing" as const)
          : ("list-named-query-param-invalid" as const),
      message: problem.message,
    })),
    ...judged.unknown.map(key => ({
      path: inputAt(key),
      nodeId,
      code: "list-named-query-param-unknown" as const,
      message: NAMED_QUERY_TEXT.paramUnknown(declaration.label, key),
    })),
  ];
  // A list split into pages counts its pages from its query's total, so a
  // query declared without one gives the route nothing to count by. Judged
  // here, against the declaration, so the save, the editor and the API all
  // refuse it with the same words.
  if (query.paginate === true && declaration.total !== true) {
    found.push({
      path: at("paginate"),
      nodeId,
      code: "list-named-query-uncounted",
      message: NAMED_QUERY_TEXT.uncounted(declaration.label),
    });
  }
  const rows = declaration.rows;
  const rowsCollection = "collection" in rows ? rows.collection : undefined;
  if (rowsCollection !== undefined && unreadable(judgement, rowsCollection)) {
    found.push({
      path: at("namedQuery"),
      nodeId,
      code: "list-named-query-rows-hidden",
      message: NAMED_QUERY_TEXT.rowsHidden(
        declaration.label,
        collectionWords(judgement, rowsCollection)
      ),
    });
  }
  const hidden =
    judgement.fields === undefined
      ? []
      : namedQueryHiddenReads(declaration, judgement.fields);
  for (const read of hidden) {
    found.push({
      path: at("namedQuery"),
      nodeId,
      code: "list-named-query-reads-hidden",
      message: NAMED_QUERY_TEXT.readsHidden(read.label, read.fields),
    });
  }
  return found;
}
