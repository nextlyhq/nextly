/**
 * The list filter keeping entries of one collection with a part in one stage of their workflow,
 * each part's stage read as `partStage` reads it for every step and assignment. That is its review
 * state's stage, read as the first stage when the workflow no longer has it; and for a part with
 * none, where its content puts it: the first stage while the part is not live, the after-publish
 * stage while it is live with a working draft, and no stage while it is live with nothing
 * unpublished. Liveness is the versions domain's one condition (`partLiveCondition`), and a
 * pending change its working-draft shape (`pendingPartCondition`), so the filter and the read of
 * a document's review cannot place a part in two stages.
 *
 * The parts are the review read's: the shared part, and each configured language of a localized
 * collection, among the languages the read was judged for.
 *
 * @module domains/workflows/stage-condition
 * @experimental
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { reviewStatesTables } from "../../schemas/review-states";
import {
  partLiveCondition,
  type PartLivenessInputs,
} from "../versions/part-liveness";
import { pendingPartCondition } from "../versions/pending-change-condition";

import { workflowAttachedTo } from "./registry";

/**
 * The condition keeping entries of `collectionName` with a part in `stage`. A collection no
 * workflow is attached to, or a stage its workflow does not have, keeps no entry.
 *
 * @experimental
 */
export function stageCondition(args: {
  dialect: SupportedDialect;
  collectionName: string;
  /** The read's id and status columns, the condition correlated with each row. */
  entryId: SQLWrapper;
  status: SQLWrapper | undefined;
  stage: string;
  /** The languages the read was judged for, or null for every one. */
  locales: readonly string[] | null;
  /** Whether the collection is localized, and the site's languages and default language. */
  localized: boolean;
  configuredLocales: readonly string[];
  defaultLocale: string | null;
  liveness: PartLivenessInputs;
}): SQL {
  const states = reviewStatesTables(args.dialect).nextlyReviewStates;
  const registered = workflowAttachedTo("collection", args.collectionName);
  const workflow = registered?.workflow;
  const known = workflow?.stages.map(stage => stage.name) ?? [];
  if (!workflow || !known.includes(args.stage)) {
    return inArray(states.stage, []);
  }
  const parts: (string | null)[] = [
    null,
    ...(args.localized
      ? args.configuredLocales.filter(
          locale => args.locales === null || args.locales.includes(locale)
        )
      : []),
  ];
  /** A review state of `part` of the row's document, holding `holds`. */
  const recorded = (part: string | null, holds?: SQL): SQL =>
    recordedCondition(args, part, holds);
  const first = args.stage === workflow.firstStage;
  const afterPublish = args.stage === workflow.afterPublish;
  const inStage = (part: string | null): SQL | undefined => {
    // Where its content puts a part with no review state: the first stage while it is not live,
    // the after-publish stage while it is live with a working draft.
    const pendingLive = afterPublish
      ? and(
          sql`NOT ${recorded(part)}`,
          liveCondition(args, part),
          pendingPartCondition({
            dialect: args.dialect,
            collectionName: args.collectionName,
            entryId: args.entryId,
            part,
          })
        )
      : undefined;
    return or(
      recorded(part, eq(states.stage, args.stage)),
      // A stage the workflow no longer has reads as the first stage.
      first ? recorded(part, notInArray(states.stage, known)) : undefined,
      first ? unmovedPartCondition({ ...args, part }) : undefined,
      pendingLive
    );
  };
  return or(...parts.map(inStage)) ?? inArray(states.stage, []);
}

/** Where a document's part is read from: the document's row, and its collection's place. */
interface PartOfRow {
  dialect: SupportedDialect;
  collectionName: string;
  /** The read's id and status columns, the condition correlated with each row. */
  entryId: SQLWrapper;
  status: SQLWrapper | undefined;
  defaultLocale: string | null;
  liveness: PartLivenessInputs;
}

/** A review state of `part` of the row's document, holding `holds`. */
function recordedCondition(
  args: Pick<PartOfRow, "dialect" | "collectionName" | "entryId">,
  part: string | null,
  holds?: SQL
): SQL {
  const states = reviewStatesTables(args.dialect).nextlyReviewStates;
  return sql`EXISTS (SELECT 1 FROM ${states} WHERE ${and(
    eq(states.scopeKind, "collection"),
    eq(states.scopeSlug, args.collectionName),
    eq(states.entryId, args.entryId),
    part === null ? isNull(states.part) : eq(states.part, part),
    holds
  )})`;
}

/** Whether `part` of the row's document is live, by the versions domain's one condition. */
function liveCondition(args: PartOfRow, part: string | null): SQL {
  return partLiveCondition({
    ...args.liveness,
    part,
    defaultLocale: args.defaultLocale,
    id: args.entryId,
    status: args.status ?? sql`NULL`,
  });
}

/**
 * Whether `part` of the row's document has stood in its workflow's first stage since the document
 * was created, no step having moved it: it has no review state, and it is not live. The list's
 * stage filter and the waiting list both read an unmoved part by it, so they cannot disagree.
 *
 * @experimental
 */
export function unmovedPartCondition(
  args: PartOfRow & { part: string | null }
): SQL {
  return sql`(NOT ${recordedCondition(args, args.part)} AND NOT ${liveCondition(args, args.part)})`;
}
