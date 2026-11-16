/**
 * A list's related source: the collection a to-many relation leads to, and
 * whether the relation it names suits the list.
 *
 * @module list-query-relations
 */
import type {
  ListFieldCode,
  ListQuery,
  ListQueryProp,
  ListRelation,
} from "./list-query-contract";
import {
  type EnclosingList,
  type Finding,
  type ListFields,
  type ListQueryJudgement,
  listRelationTarget,
  readableField,
} from "./list-query-fields";
import { NAMED_QUERY_TEXT } from "./named-query";

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
  if (outer.query.namedQuery !== undefined) {
    return {
      problem: NAMED_QUERY_TEXT.nestedRelated,
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
export function relationFindings(
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
