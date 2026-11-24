/**
 * The list filter keeping entries of one collection with a part assigned to any of `holders`: the
 * people and roles the reader stands for (`holdersOf`), as the waiting list counts work "mine". A
 * correlated `EXISTS` over the review states, so the page and its count read one condition.
 *
 * @module domains/workflows/assigned-to-condition
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { reviewStatesTables } from "../../schemas/review-states";

import { workflowAttachedTo } from "./registry";
import type { ReviewAssignee } from "./review-state-repository";

/**
 * The condition keeping entries of `collectionName` with a part assigned to one of `holders`, in
 * any of the languages `locales` names or in the shared part (`null` considers every language, as
 * the other workflow filters take it). A collection no workflow is attached to, or a reader who
 * stands for no one, keeps no entry.
 */
export function assignedToCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
  locales: readonly string[] | null;
  holders: readonly ReviewAssignee[];
}): SQL {
  const states = reviewStatesTables(args.dialect).nextlyReviewStates;
  const users = args.holders
    .filter(each => each.kind === "user")
    .map(each => each.id);
  const roles = args.holders
    .filter(each => each.kind === "role")
    .map(each => each.id);
  if (
    !workflowAttachedTo("collection", args.collectionName) ||
    (users.length === 0 && roles.length === 0)
  ) {
    return inArray(states.stage, []);
  }
  return sql`EXISTS (SELECT 1 FROM ${states} WHERE ${and(
    eq(states.scopeKind, "collection"),
    eq(states.scopeSlug, args.collectionName),
    eq(states.entryId, args.entryId),
    or(
      users.length > 0
        ? and(
            eq(states.assigneeKind, "user"),
            inArray(states.assigneeId, users)
          )
        : undefined,
      roles.length > 0
        ? and(
            eq(states.assigneeKind, "role"),
            inArray(states.assigneeId, roles)
          )
        : undefined
    ),
    args.locales === null
      ? undefined
      : args.locales.length === 0
        ? isNull(states.part)
        : or(isNull(states.part), inArray(states.part, [...args.locales]))
  )})`;
}
