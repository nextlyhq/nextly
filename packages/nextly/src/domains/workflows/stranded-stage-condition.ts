/**
 * "This entry has a part in a stage its workflow no longer has", as a condition on an entry read.
 *
 * Built from {@link strandedStageShape}, the one statement of which stages strand a part, so
 * this condition and the list of stranded parts (`strandedReviewStates`) cannot answer the
 * question two ways.
 *
 * @module domains/workflows/stranded-stage-condition
 * @experimental Read by the `_strandedStage` list filter, which may change until the
 *   dashboard's Needs attention card is complete.
 */
import type {
  SupportedDialect,
  WhereCondition,
} from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  Column,
  eq,
  inArray,
  is,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { NextlyError } from "../../errors/nextly-error";
import { reviewStatesTables } from "../../schemas/review-states";

import { workflowAttachedTo } from "./registry";
import { strandedStageShape } from "./stranded-stages";

type ReviewStatesTable = ReturnType<
  typeof reviewStatesTables
>["nextlyReviewStates"];

/**
 * One condition of the stranded shape, on the review states table. Only the operator the shape
 * uses is translated; any other is refused as an internal fault rather than skipped, since a
 * skipped condition would keep entries with nothing stranded.
 */
function shapeCondition(
  states: ReviewStatesTable,
  condition: WhereCondition
): SQL {
  const column: unknown = Object.prototype.hasOwnProperty.call(
    states,
    condition.column
  )
    ? (states as unknown as Record<string, unknown>)[condition.column]
    : undefined;
  if (
    is(column, Column) &&
    condition.op === "NOT IN" &&
    Array.isArray(condition.value)
  ) {
    return notInArray(column, condition.value);
  }
  throw NextlyError.internal({
    logContext: {
      reason: "stranded-stage-shape-untranslatable",
      column: condition.column,
      op: condition.op,
    },
  });
}

/**
 * The condition keeping entries of one collection with a part in a stage its workflow no longer
 * has, in any of the languages `locales` names or in the shared part. `locales` is the languages
 * the read's access rules were judged for, as the pending-change condition takes it, so a part
 * in a language withheld from the read keeps no entry; `null` considers every language. A
 * collection no workflow is attached to has no stranded part, and keeps no entry.
 *
 * @experimental
 */
export function strandedStageCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  entryId: SQLWrapper;
  locales: readonly string[] | null;
}): SQL {
  const states = reviewStatesTables(args.dialect).nextlyReviewStates;
  const registered = workflowAttachedTo("collection", args.collectionName);
  if (!registered) return inArray(states.stage, []);
  return sql`EXISTS (SELECT 1 FROM ${states} WHERE ${and(
    eq(states.scopeKind, "collection"),
    eq(states.scopeSlug, args.collectionName),
    eq(states.entryId, args.entryId),
    ...strandedStageShape(registered.workflow).map(condition =>
      shapeCondition(states, condition)
    ),
    args.locales === null
      ? undefined
      : args.locales.length === 0
        ? isNull(states.part)
        : or(isNull(states.part), inArray(states.part, [...args.locales]))
  )})`;
}
